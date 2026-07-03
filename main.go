package main

import (
	"crypto/sha1"
	"encoding/json"
	"encoding/xml"
	"flag"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	userAgent      = "Blogroll.it/1.0 (+https://blogroll.it)"
	maxConcurrency = 30
	connectTimeout = 10 * time.Second
	readTimeout    = 15 * time.Second
	maxDays        = 60
	minBlogPosts   = 10
	opmlFile       = "engblogs.opml"
	cacheFile      = "cache.json"
	outputDir      = "public"
)

// OPML structures

type OPML struct {
	XMLName xml.Name `xml:"opml"`
	Body    OPMLBody `xml:"body"`
}

type OPMLBody struct {
	Outlines []OPMLOutline `xml:"outline"`
}

type OPMLOutline struct {
	Type        string        `xml:"type,attr"`
	Text        string        `xml:"text,attr"`
	Title       string        `xml:"title,attr"`
	XMLURL      string        `xml:"xmlUrl,attr"`
	HTMLURL     string        `xml:"htmlUrl,attr"`
	Description string        `xml:"description,attr"`
	Children    []OPMLOutline `xml:"outline"`
}

// Feed structures (support both RSS and Atom)

type RSSFeed struct {
	XMLName xml.Name   `xml:"rss"`
	Channel RSSChannel `xml:"channel"`
}

type RSSChannel struct {
	Items []RSSItem `xml:"item"`
}

type RSSItem struct {
	Title   string `xml:"title"`
	Link    string `xml:"link"`
	PubDate string `xml:"pubDate"`
	GUID    string `xml:"guid"`
}

type AtomFeed struct {
	XMLName xml.Name    `xml:"feed"`
	Entries []AtomEntry `xml:"entry"`
}

type AtomEntry struct {
	Title   string     `xml:"title"`
	Links   []AtomLink `xml:"link"`
	Updated string     `xml:"updated"`
	Published string   `xml:"published"`
	ID      string     `xml:"id"`
}

type AtomLink struct {
	Href string `xml:"href,attr"`
	Rel  string `xml:"rel,attr"`
	Type string `xml:"type,attr"`
}

// Application types

type Feed struct {
	Title       string
	XMLURL      string
	HTMLURL     string
	Description string
	Slug        string
}

type Entry struct {
	BlogName  string
	BlogURL   string
	BlogSlug  string    `json:"-"`
	Title     string
	URL       string
	Published time.Time
}

type CacheEntry struct {
	ETag         string  `json:"etag,omitempty"`
	LastModified string  `json:"last_modified,omitempty"`
	Entries      []Entry `json:"entries,omitempty"`
}

type Cache map[string]CacheEntry

type DateGroup struct {
	Date    string
	Entries []Entry
}

type TemplateData struct {
	Groups     []DateGroup
	FeedCount  int
	EntryCount int
	MaxDays    int
	BuiltAt    string
}

// --- Slug generation ---

func sha1Slug(s string) string {
	h := sha1.Sum([]byte(s))
	return fmt.Sprintf("%x", h)[:12]
}

func slugForFeed(f Feed) string {
	target := f.HTMLURL
	if target == "" {
		target = f.XMLURL
	}
	u, err := url.Parse(target)
	if err != nil || u.Hostname() == "" {
		return sha1Slug(f.XMLURL)
	}
	return strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
}

func buildSlugs(feeds []Feed) map[string]string {
	seen := make(map[string]bool)
	result := make(map[string]string)
	for _, f := range feeds {
		slug := slugForFeed(f)
		if seen[slug] {
			fmt.Fprintf(os.Stderr, "WARNING: duplicate slug %q for %s — check engblogs.opml\n", slug, f.XMLURL)
			slug = sha1Slug(f.XMLURL)
		}
		seen[slug] = true
		result[f.XMLURL] = slug
	}
	return result
}

func main() {
	skipFetch := flag.Bool("skip-fetch", false, "Skip fetching feeds, rebuild HTML from cache only")
	flag.Parse()

	feeds, err := parseOPML(opmlFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing OPML: %v\n", err)
		os.Exit(1)
	}

	feeds = deduplicateFeeds(feeds)
	cache := loadCache(cacheFile)

	var entries []Entry
	if *skipFetch {
		fmt.Fprintf(os.Stderr, "Skipping fetch, rebuilding from cache\n")
		for _, ce := range cache {
			entries = append(entries, ce.Entries...)
		}
	} else {
		fmt.Fprintf(os.Stderr, "Parsed %d unique feeds from OPML\n", len(feeds))
		var stats fetchStats
		entries, stats = fetchAllFeeds(feeds, cache)
		saveCache(cacheFile, cache)
		fmt.Fprintf(os.Stderr, "Feeds: %d total, %d ok, %d failed\n",
			stats.total, stats.success, stats.failed)
	}

	slugMap := buildSlugs(feeds)
	htmlToSlug := make(map[string]string)
	for i, f := range feeds {
		feeds[i].Slug = slugMap[f.XMLURL]
		htmlToSlug[f.HTMLURL] = slugMap[f.XMLURL]
	}
	for i := range entries {
		entries[i].BlogSlug = htmlToSlug[entries[i].BlogURL]
	}

	cutoff := time.Now().UTC().AddDate(0, 0, -maxDays)
	var recent []Entry
	for _, e := range entries {
		if e.Published.After(cutoff) {
			recent = append(recent, e)
		}
	}

	recent = deduplicateEntries(recent)

	sort.Slice(recent, func(i, j int) bool {
		return recent[i].Published.After(recent[j].Published)
	})

	groups := groupByDate(recent)

	fmt.Fprintf(os.Stderr, "Entries: %d (last 7 days)\n", len(recent))

	if err := renderHTML(groups, len(feeds), len(recent)); err != nil {
		fmt.Fprintf(os.Stderr, "Error rendering HTML: %v\n", err)
		os.Exit(1)
	}

	if err := copyOPML(); err != nil {
		fmt.Fprintf(os.Stderr, "Error copying OPML: %v\n", err)
		os.Exit(1)
	}

	if err := renderDirectory(feeds, entries); err != nil {
		fmt.Fprintf(os.Stderr, "Error rendering directory: %v\n", err)
		os.Exit(1)
	}

	if err := renderBlogPages(feeds, entries); err != nil {
		fmt.Fprintf(os.Stderr, "Error rendering blog pages: %v\n", err)
		os.Exit(1)
	}

	fmt.Fprintf(os.Stderr, "Built index, directory, and %d blog pages successfully\n", len(feeds))
}

// --- OPML parsing ---

func parseOPML(path string) ([]Feed, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var opml OPML
	if err := xml.Unmarshal(data, &opml); err != nil {
		return nil, err
	}

	var feeds []Feed
	var extract func(outlines []OPMLOutline)
	extract = func(outlines []OPMLOutline) {
		for _, o := range outlines {
			if o.XMLURL != "" {
				title := o.Title
				if title == "" {
					title = o.Text
				}
				feeds = append(feeds, Feed{
					Title:       title,
					XMLURL:      o.XMLURL,
					HTMLURL:     o.HTMLURL,
					Description: o.Description,
				})
			}
			if len(o.Children) > 0 {
				extract(o.Children)
			}
		}
	}
	extract(opml.Body.Outlines)
	return feeds, nil
}

func deduplicateFeeds(feeds []Feed) []Feed {
	seen := make(map[string]bool)
	var result []Feed
	for _, f := range feeds {
		if !seen[f.XMLURL] {
			seen[f.XMLURL] = true
			result = append(result, f)
		}
	}
	return result
}

// --- Cache ---

func loadCache(path string) Cache {
	data, err := os.ReadFile(path)
	if err != nil {
		return make(Cache)
	}
	var c Cache
	if err := json.Unmarshal(data, &c); err != nil {
		return make(Cache)
	}
	return c
}

func saveCache(path string, cache Cache) {
	data, err := json.Marshal(cache)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Warning: could not marshal cache: %v\n", err)
		return
	}
	os.WriteFile(path, data, 0644)
}

// --- Feed fetching ---

type fetchStats struct {
	total   int
	success int
	failed  int
}

func fetchAllFeeds(feeds []Feed, cache Cache) ([]Entry, fetchStats) {
	var (
		mu      sync.Mutex
		entries []Entry
		stats   fetchStats
		wg      sync.WaitGroup
		sem     = make(chan struct{}, maxConcurrency)
	)

	stats.total = len(feeds)
	client := &http.Client{
		Timeout: connectTimeout + readTimeout,
	}

	for _, feed := range feeds {
		wg.Add(1)
		sem <- struct{}{}
		go func(f Feed) {
			defer wg.Done()
			defer func() { <-sem }()

			fetched, err := fetchFeed(client, f, cache, &mu)
			mu.Lock()
			if err != nil {
				stats.failed++
				fmt.Fprintf(os.Stderr, "  FAIL %s (%s): %v\n", f.Title, f.XMLURL, err)
			} else {
				stats.success++
				entries = append(entries, fetched...)
			}
			mu.Unlock()
		}(feed)
	}

	wg.Wait()
	return entries, stats
}

func fetchFeed(client *http.Client, feed Feed, cache Cache, mu *sync.Mutex) ([]Entry, error) {
	req, err := http.NewRequest("GET", feed.XMLURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)

	mu.Lock()
	if cached, ok := cache[feed.XMLURL]; ok {
		if cached.ETag != "" {
			req.Header.Set("If-None-Match", cached.ETag)
		}
		if cached.LastModified != "" {
			req.Header.Set("If-Modified-Since", cached.LastModified)
		}
	}
	mu.Unlock()

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		mu.Lock()
		cached := cache[feed.XMLURL]
		mu.Unlock()
		return cached.Entries, nil
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	entries, err := parseFeed(body, feed)
	if err != nil {
		return nil, err
	}

	mu.Lock()
	cache[feed.XMLURL] = CacheEntry{
		ETag:         resp.Header.Get("ETag"),
		LastModified: resp.Header.Get("Last-Modified"),
		Entries:      entries,
	}
	mu.Unlock()

	return entries, nil
}

func parseFeed(data []byte, feed Feed) ([]Entry, error) {
	// Try RSS first
	var rss RSSFeed
	if err := xml.Unmarshal(data, &rss); err == nil && len(rss.Channel.Items) > 0 {
		return parseRSSItems(rss.Channel.Items, feed), nil
	}

	// Try Atom
	var atom AtomFeed
	if err := xml.Unmarshal(data, &atom); err == nil && len(atom.Entries) > 0 {
		return parseAtomEntries(atom.Entries, feed), nil
	}

	// Try RSS without wrapper (some feeds use <rdf:RDF> or bare <channel>)
	type BareChannel struct {
		XMLName xml.Name  `xml:"channel"`
		Items   []RSSItem `xml:"item"`
	}
	var bare BareChannel
	if err := xml.Unmarshal(data, &bare); err == nil && len(bare.Items) > 0 {
		return parseRSSItems(bare.Items, feed), nil
	}

	// Try RDF format
	type RDFFeed struct {
		XMLName xml.Name  `xml:"RDF"`
		Items   []RSSItem `xml:"item"`
	}
	var rdf RDFFeed
	if err := xml.Unmarshal(data, &rdf); err == nil && len(rdf.Items) > 0 {
		return parseRSSItems(rdf.Items, feed), nil
	}

	return nil, fmt.Errorf("unrecognized feed format")
}

func parseRSSItems(items []RSSItem, feed Feed) []Entry {
	var entries []Entry
	for _, item := range items {
		t := parseTime(item.PubDate)
		link := strings.TrimSpace(item.Link)
		if link == "" {
			link = strings.TrimSpace(item.GUID)
		}
		if link == "" {
			continue
		}
		entries = append(entries, Entry{
			BlogName:  feed.Title,
			BlogURL:   feed.HTMLURL,
			Title:     strings.TrimSpace(item.Title),
			URL:       link,
			Published: t,
		})
	}
	return entries
}

func parseAtomEntries(items []AtomEntry, feed Feed) []Entry {
	var entries []Entry
	for _, item := range items {
		dateStr := item.Published
		if dateStr == "" {
			dateStr = item.Updated
		}
		t := parseTime(dateStr)

		link := ""
		for _, l := range item.Links {
			if l.Rel == "alternate" || l.Rel == "" {
				link = l.Href
				break
			}
		}
		if link == "" && len(item.Links) > 0 {
			link = item.Links[0].Href
		}
		if link == "" {
			link = item.ID
		}
		if link == "" {
			continue
		}

		entries = append(entries, Entry{
			BlogName:  feed.Title,
			BlogURL:   feed.HTMLURL,
			Title:     strings.TrimSpace(item.Title),
			URL:       strings.TrimSpace(link),
			Published: t,
		})
	}
	return entries
}

var timeFormats = []string{
	time.RFC1123Z,
	time.RFC1123,
	time.RFC3339,
	time.RFC3339Nano,
	"2006-01-02T15:04:05Z",
	"2006-01-02T15:04:05-07:00",
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05",
	"Mon, 2 Jan 2006 15:04:05 -0700",
	"Mon, 2 Jan 2006 15:04:05 MST",
	"Mon, 02 Jan 2006 15:04:05 -0700",
	"Mon, 02 Jan 2006 15:04:05 MST",
	"02 Jan 2006 15:04:05 -0700",
	"2 Jan 2006 15:04:05 -0700",
	"2006-01-02",
}

func parseTime(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}
	}
	for _, format := range timeFormats {
		if t, err := time.Parse(format, s); err == nil {
			return t.UTC()
		}
	}
	return time.Time{}
}

// --- Deduplication & grouping ---

func deduplicateEntries(entries []Entry) []Entry {
	seen := make(map[string]bool)
	var result []Entry
	for _, e := range entries {
		normalized := strings.TrimRight(strings.TrimSpace(e.URL), "/")
		if !seen[normalized] {
			seen[normalized] = true
			result = append(result, e)
		}
	}
	return result
}

var italianMonths = [...]string{
	"", "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
	"luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
}

var italianMonthsShort = [...]string{
	"", "gen", "feb", "mar", "apr", "mag", "giu",
	"lug", "ago", "set", "ott", "nov", "dic",
}

func italianDate(t time.Time) string {
	return fmt.Sprintf("%d %s %d", t.Day(), italianMonths[t.Month()], t.Year())
}

func italianDateShort(t time.Time) string {
	return fmt.Sprintf("%d %s %d", t.Day(), italianMonthsShort[t.Month()], t.Year())
}

func groupByDate(entries []Entry) []DateGroup {
	groups := make(map[string][]Entry)
	var order []string
	for _, e := range entries {
		key := e.Published.Format("2006-01-02")
		if _, exists := groups[key]; !exists {
			order = append(order, key)
		}
		groups[key] = append(groups[key], e)
	}
	var result []DateGroup
	for _, key := range order {
		t, _ := time.Parse("2006-01-02", key)
		result = append(result, DateGroup{
			Date:    italianDate(t),
			Entries: groups[key],
		})
	}
	return result
}

// --- Rendering ---

type BlogData struct {
	Feed    Feed
	Entries []Entry
	BuiltAt string
}

func groupEntriesByBlog(entries []Entry) map[string][]Entry {
	groups := make(map[string][]Entry)
	for _, e := range entries {
		groups[e.BlogURL] = append(groups[e.BlogURL], e)
	}
	return groups
}

func renderBlogPages(feeds []Feed, allEntries []Entry) error {
	cutoff := time.Now().UTC().AddDate(0, 0, -maxDays)
	byBlog := groupEntriesByBlog(allEntries)

	tmpl, err := template.New("template-blog.html").Funcs(template.FuncMap{
		"italianDateShort": italianDateShort,
	}).ParseFiles("template-blog.html")
	if err != nil {
		return err
	}

	builtAt := time.Now().UTC().Format("2006-01-02 15:04 UTC")

	for _, feed := range feeds {
		all := byBlog[feed.HTMLURL]
		sort.Slice(all, func(i, j int) bool {
			return all[i].Published.After(all[j].Published)
		})

		var recent []Entry
		for _, e := range all {
			if e.Published.After(cutoff) {
				recent = append(recent, e)
			}
		}

		if len(recent) < minBlogPosts && len(all) > len(recent) {
			for _, e := range all[len(recent):] {
				if len(recent) >= minBlogPosts {
					break
				}
				recent = append(recent, e)
			}
		}

		dir := filepath.Join(outputDir, "sites", feed.Slug)
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}

		f, err := os.Create(filepath.Join(dir, "index.html"))
		if err != nil {
			return err
		}

		data := BlogData{
			Feed:    feed,
			Entries: recent,
			BuiltAt: builtAt,
		}

		if err := tmpl.Execute(f, data); err != nil {
			f.Close()
			return err
		}
		f.Close()
	}
	return nil
}

type FeedWithLatest struct {
	Feed
	LatestEntry *Entry
}

type DirectoryData struct {
	Feeds     []FeedWithLatest
	FeedCount int
	BuiltAt   string
}

func renderDirectory(feeds []Feed, allEntries []Entry) error {
	dir := filepath.Join(outputDir, "directory")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	latest := make(map[string]*Entry)
	for i := range allEntries {
		e := &allEntries[i]
		if prev, ok := latest[e.BlogURL]; !ok || e.Published.After(prev.Published) {
			latest[e.BlogURL] = e
		}
	}

	sorted := make([]FeedWithLatest, len(feeds))
	for i, f := range feeds {
		sorted[i] = FeedWithLatest{Feed: f, LatestEntry: latest[f.HTMLURL]}
	}
	sort.Slice(sorted, func(i, j int) bool {
		return strings.ToLower(sorted[i].Title) < strings.ToLower(sorted[j].Title)
	})

	tmpl, err := template.New("template-directory.html").Funcs(template.FuncMap{
		"italianDateShort": italianDateShort,
	}).ParseFiles("template-directory.html")
	if err != nil {
		return err
	}

	data := DirectoryData{
		Feeds:     sorted,
		FeedCount: len(feeds),
		BuiltAt:   time.Now().UTC().Format("2006-01-02 15:04 UTC"),
	}

	f, err := os.Create(filepath.Join(dir, "index.html"))
	if err != nil {
		return err
	}
	defer f.Close()

	return tmpl.Execute(f, data)
}

func renderHTML(groups []DateGroup, feedCount, entryCount int) error {
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return err
	}

	tmpl, err := template.New("template.html").ParseFiles("template.html")
	if err != nil {
		return err
	}

	data := TemplateData{
		Groups:     groups,
		FeedCount:  feedCount,
		EntryCount: entryCount,
		MaxDays:    maxDays,
		BuiltAt:    time.Now().UTC().Format("2006-01-02 15:04 UTC"),
	}

	f, err := os.Create(filepath.Join(outputDir, "index.html"))
	if err != nil {
		return err
	}
	defer f.Close()

	return tmpl.Execute(f, data)
}

func copyOPML() error {
	data, err := os.ReadFile(opmlFile)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(outputDir, opmlFile), data, 0644)
}


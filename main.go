package main

import (
	"crypto/sha1"
	"encoding/json"
	"encoding/xml"
	"flag"
	"fmt"
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
	opmlFile       = "itblogs.opml"
	cacheFile      = "cache.json"
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
	Type     string        `xml:"type,attr"`
	Text     string        `xml:"text,attr"`
	Title    string        `xml:"title,attr"`
	XMLURL   string        `xml:"xmlUrl,attr"`
	HTMLURL  string        `xml:"htmlUrl,attr"`
	Children []OPMLOutline `xml:"outline"`
}

// Feed structures (support both RSS and Atom)

type RSSFeed struct {
	XMLName xml.Name   `xml:"rss"`
	Channel RSSChannel `xml:"channel"`
}

type RSSChannel struct {
	Description string    `xml:"description"`
	Items       []RSSItem `xml:"item"`
}

type RSSItem struct {
	Title   string `xml:"title"`
	Link    string `xml:"link"`
	PubDate string `xml:"pubDate"`
	GUID    string `xml:"guid"`
}

type AtomFeed struct {
	XMLName  xml.Name    `xml:"feed"`
	Subtitle string      `xml:"subtitle"`
	Entries  []AtomEntry `xml:"entry"`
}

type AtomEntry struct {
	Title     string     `xml:"title"`
	Links     []AtomLink `xml:"link"`
	Updated   string     `xml:"updated"`
	Published string     `xml:"published"`
	ID        string     `xml:"id"`
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
	Description  string  `json:"description,omitempty"`
	Entries      []Entry `json:"entries,omitempty"`
}

type Cache map[string]CacheEntry

// JSON output types

type SiteData struct {
	BuiltAt    string      `json:"builtAt"`
	OPMLFile   string      `json:"opmlFile"`
	MaxDays    int         `json:"maxDays"`
	FeedCount  int         `json:"feedCount"`
	EntryCount int         `json:"entryCount"`
	Groups     []JSONGroup `json:"groups"`
	Feeds      []JSONFeed  `json:"feeds"`
}

type JSONGroup struct {
	Date    string      `json:"date"`
	Entries []JSONEntry `json:"entries"`
}

type JSONFeed struct {
	Title       string      `json:"title"`
	XMLURL      string      `json:"xmlUrl"`
	HTMLURL     string      `json:"htmlUrl"`
	Description string      `json:"description"`
	Slug        string      `json:"slug"`
	LatestEntry *JSONEntry  `json:"latestEntry"`
	Entries     []JSONEntry `json:"entries"`
}

type JSONEntry struct {
	BlogName  string    `json:"blogName,omitempty"`
	BlogSlug  string    `json:"blogSlug,omitempty"`
	Title     string    `json:"title"`
	URL       string    `json:"url"`
	Published time.Time `json:"published"`
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
	opml := flag.String("opml", opmlFile, "Path to OPML file")
	flag.Parse()

	feeds, err := parseOPML(*opml)
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
		if ce, ok := cache[f.XMLURL]; ok && ce.Description != "" {
			feeds[i].Description = ce.Description
		}
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

	fmt.Fprintf(os.Stderr, "Entries: %d (last %d days)\n", len(recent), maxDays)

	siteData := buildSiteData(feeds, entries, recent, filepath.Base(*opml))
	if err := writeJSON(siteData, "src/data/blogroll.json"); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing JSON: %v\n", err)
		os.Exit(1)
	}

	if err := copyOPML(*opml); err != nil {
		fmt.Fprintf(os.Stderr, "Error copying OPML: %v\n", err)
		os.Exit(1)
	}

	fmt.Fprintf(os.Stderr, "Wrote src/data/blogroll.json (%d feeds, %d entries)\n", len(feeds), len(recent))
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
					Title:   title,
					XMLURL:  o.XMLURL,
					HTMLURL: o.HTMLURL,
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

	entries, desc, err := parseFeed(body, feed)
	if err != nil {
		return nil, err
	}

	mu.Lock()
	cache[feed.XMLURL] = CacheEntry{
		ETag:         resp.Header.Get("ETag"),
		LastModified: resp.Header.Get("Last-Modified"),
		Description:  desc,
		Entries:      entries,
	}
	mu.Unlock()

	return entries, nil
}

func parseFeed(data []byte, feed Feed) ([]Entry, string, error) {
	// Try RSS first
	var rss RSSFeed
	if err := xml.Unmarshal(data, &rss); err == nil && len(rss.Channel.Items) > 0 {
		return parseRSSItems(rss.Channel.Items, feed), rss.Channel.Description, nil
	}

	// Try Atom
	var atom AtomFeed
	if err := xml.Unmarshal(data, &atom); err == nil && len(atom.Entries) > 0 {
		return parseAtomEntries(atom.Entries, feed), atom.Subtitle, nil
	}

	// Try RSS without wrapper (some feeds use <rdf:RDF> or bare <channel>)
	type BareChannel struct {
		XMLName     xml.Name  `xml:"channel"`
		Description string    `xml:"description"`
		Items       []RSSItem `xml:"item"`
	}
	var bare BareChannel
	if err := xml.Unmarshal(data, &bare); err == nil && len(bare.Items) > 0 {
		return parseRSSItems(bare.Items, feed), bare.Description, nil
	}

	// Try RDF format
	type RDFFeed struct {
		XMLName xml.Name  `xml:"RDF"`
		Items   []RSSItem `xml:"item"`
	}
	var rdf RDFFeed
	if err := xml.Unmarshal(data, &rdf); err == nil && len(rdf.Items) > 0 {
		return parseRSSItems(rdf.Items, feed), "", nil
	}

	return nil, "", fmt.Errorf("unrecognized feed format")
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

// --- Deduplication ---

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

// --- JSON output ---

func groupEntriesByBlog(entries []Entry) map[string][]Entry {
	groups := make(map[string][]Entry)
	for _, e := range entries {
		groups[e.BlogURL] = append(groups[e.BlogURL], e)
	}
	return groups
}

func toJSONEntry(e Entry) JSONEntry {
	return JSONEntry{
		BlogName:  e.BlogName,
		BlogSlug:  e.BlogSlug,
		Title:     e.Title,
		URL:       e.URL,
		Published: e.Published,
	}
}

func buildSiteData(feeds []Feed, allEntries []Entry, recent []Entry, opmlFileName string) SiteData {
	// Build day groups from recent entries (already sorted desc)
	groupMap := make(map[string][]JSONEntry)
	var groupOrder []string
	for _, e := range recent {
		key := e.Published.Format("2006-01-02")
		if _, exists := groupMap[key]; !exists {
			groupOrder = append(groupOrder, key)
		}
		groupMap[key] = append(groupMap[key], toJSONEntry(e))
	}
	groups := make([]JSONGroup, len(groupOrder))
	for i, key := range groupOrder {
		groups[i] = JSONGroup{Date: key, Entries: groupMap[key]}
	}

	// Build per-feed data
	cutoff := time.Now().UTC().AddDate(0, 0, -maxDays)
	byBlog := groupEntriesByBlog(allEntries)

	jsonFeeds := make([]JSONFeed, len(feeds))
	for i, f := range feeds {
		all := byBlog[f.HTMLURL]
		sort.Slice(all, func(a, b int) bool {
			return all[a].Published.After(all[b].Published)
		})

		var latestEntry *JSONEntry
		if len(all) > 0 {
			je := toJSONEntry(all[0])
			latestEntry = &je
		}

		var blogRecent []Entry
		for _, e := range all {
			if e.Published.After(cutoff) {
				blogRecent = append(blogRecent, e)
			}
		}
		if len(blogRecent) < minBlogPosts && len(all) > len(blogRecent) {
			for _, e := range all[len(blogRecent):] {
				if len(blogRecent) >= minBlogPosts {
					break
				}
				blogRecent = append(blogRecent, e)
			}
		}

		entries := make([]JSONEntry, len(blogRecent))
		for j, e := range blogRecent {
			entries[j] = toJSONEntry(e)
		}

		jsonFeeds[i] = JSONFeed{
			Title:       f.Title,
			XMLURL:      f.XMLURL,
			HTMLURL:     f.HTMLURL,
			Description: f.Description,
			Slug:        f.Slug,
			LatestEntry: latestEntry,
			Entries:     entries,
		}
	}

	// Sort feeds by latest entry date (directory page order)
	sort.Slice(jsonFeeds, func(i, j int) bool {
		li, lj := jsonFeeds[i].LatestEntry, jsonFeeds[j].LatestEntry
		if li == nil && lj == nil {
			return strings.ToLower(jsonFeeds[i].Title) < strings.ToLower(jsonFeeds[j].Title)
		}
		if li == nil {
			return false
		}
		if lj == nil {
			return true
		}
		return li.Published.After(lj.Published)
	})

	return SiteData{
		BuiltAt:    time.Now().UTC().Format(time.RFC3339),
		OPMLFile:   opmlFileName,
		MaxDays:    maxDays,
		FeedCount:  len(feeds),
		EntryCount: len(recent),
		Groups:     groups,
		Feeds:      jsonFeeds,
	}
}

func writeJSON(data SiteData, path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0644)
}

func copyOPML(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := os.MkdirAll("public", 0755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join("public", filepath.Base(path)), data, 0644)
}

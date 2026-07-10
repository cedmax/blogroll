# Il progetto

blogroll.it è un aggregatore di feed di siti personali italiani: nasce come risposta al risorgimento dei siti personali, e trae l'ispirazione da [Ye Olde Blogroll](https://blogroll.org) e [Engineering Blogs](https://engineeringblogs.xyz/).

## Come aggiungere un sito

Se il sito risponde ai requisiti e alle norme di condotta a seguire, è possibile farne richiesta con la [form dedicata alle proposte](/proposte/).

### Requisiti

- il sito dev'essere uno spazio personale, non un profilo su una piattaforma di publishing (es. Medium, Substack). L'hosting non conta: Neocities va benissimo, un blog su Medium no.
- il contenuto del sito dev'essere personale, non commerciale. Siti aziendali o con contenuti apertamente commerciali verranno rifiutati/cancellati.
- il feed dev'essere un RSS/Atom funzionante e in italiano. Se il feed non fosse raggiungibile o malformato, il sito risulterebbe [non disponibile](/sites/non-disponibile/) fino al prossimo fetch riuscito – verrà effettuato un tentativo ogni 6 ore. Nessuna garanzia sulla permanenza di feed sistematicamente non raggiungibili o malformati.

### Condotta

I siti con contenuti illegali, in violazione di copyright verranno eliminati. Ci riserviamo inoltre il diritto di rimuovere siti contenenti derive sessiste, razziste, transfobiche, omofobe, abiliste e inneggianti anche non apertamente a nazi/fascismo.

## Come segnalare un sito per la rimozione

Nel menu di ciascun sito nell'elenco c'è un link "Segnala il sito" per richiederne la rimozione, indicandone le motivazioni.

Sia le nuove proposte, sia le richieste di rimozione verranno valutate dal team e sarà possibile seguirne lo stato sul [repository del progetto](https://github.com/cedmax/blogroll/issues).

## Banner

Per linkare il progetto dal vostro sito, consigliamo di usare queste immagini:

**Versione chiara**

![image](/banner.gif)

```html
<a href="https://blogroll.it/">
  <img src="https://blogroll.it/banner.gif" alt="Questo sito è su blogroll.it" />
</a>
```

**Versione scura**

![image](/banner-dark.gif)

```html
<a href="https://blogroll.it/">
  <img src="https://blogroll.it/banner-dark.gif" alt="Questo sito è su blogroll.it" />
</a>
```

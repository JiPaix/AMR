import { SchedulerClass } from './../server/helpers/scheduler';
import Mirror from '.';
import icon from './icons/mangahasu.png';
import type MirrorInterface from './interfaces';
import type { SearchResult } from './types/search';
import type { MangaPage } from './types/manga';
import type { socketInstance } from '../server/types';

class MangaHasu extends Mirror implements MirrorInterface {

  constructor() {
    super({
      host: 'https://mangahasu.se',
      althost: ['https://www.mangahasu.se'],
      name: 'mangahasu',
      displayName: 'MangaHasu',
      langs: ['en'],
      waitTime: 500, // this is long but mangahasu is picky
      icon,
      meta: {
        speed: 0.5,
        quality: 0.7,
        popularity: 0.7,
      },
      options: {
        enabled: true,
        cache: true,
      },
    });
  }

  isMangaPage(url: string): boolean {
    const res = /^\/.*-\w{3,4}-p\d+\.html$/gmi.test(url);
    if(!res) this.logger('not a manga page:', url);
    return res;
  }
  isChapterPage(url: string): boolean {
    const res = /\/.*\/.*-\w{3,4}-c\d+\.html$/gmi.test(url);
    if(!res) this.logger('not a chapter page:', url);
    return res;
  }
  getChapterInfoFromString(str:string) {
    const res = /(Vol\s(\d+)\s)?Chapter\s([0-9]+(\.)?([0-9]+)?)(:\s(.*))?/gmi.exec(str);
    if(!res) this.logger('not a chapter string:', str);
    return res;
  }

  async search(query:string, socket: socketInstance|SchedulerClass, id:number) {
    try {
      // we will check if user don't need results anymore at different intervals
      let cancel = false;
      if(!(socket instanceof SchedulerClass)) {
        socket.once('stopSearchInMirrors', () => {
          this.logger('search canceled');
          cancel = true;
        });
      }

      const url = `${this.host}/advanced-search.html?keyword=${query}`;
      const $ = await this.fetch({
        url,
        waitForSelector: '.tag.search-results-a',
      }, 'html');

      for(const el of $('div.div_item')) {
        if(cancel) break; //=> 2nd cancel check, break out of loop
        const name = $('a.name-manga > h3', el).text().trim();
        const link = $('a.name-manga', el).attr('href')?.replace(this.host, '');

        if((!name || !link) || (link && !this.isMangaPage(link))) continue;

        // mangahasu images needs to be downloaded.
        const covers:string[] = [];
        const coverLink = $('.wrapper_imgage img', el).attr('src');
        if(coverLink) {
          const img = await this.downloadImage(coverLink).catch(() => undefined);
          if(img) covers.push(img);
        }

        let last_release: SearchResult['last_release'];
        const last_chapter = $('a.name-chapter > span', el).text().trim();
        const match = this.getChapterInfoFromString(last_chapter);

        if(!match) last_release = {name: last_chapter.replace(/Chapter/gi, '').trim()};

        if(match && typeof match === 'object') {
          const [, , volumeNumber, chapterNumber, , , , chapterName] = match;
          last_release = {
            name: chapterName ? chapterName.trim() : undefined,
            volume: volumeNumber ? parseInt(volumeNumber) : undefined,
            chapter: chapterNumber ? parseFloat(chapterNumber) : 0,
          };
        }

        // manga id = "mirror_name/lang/link-of-manga-page"
        const mangaId = `${this.name}/${this.langs[0]}${link.replace(this.host, '')}`;

        socket.emit('searchInMirrors', id, {
          id: mangaId,
          mirrorinfo: this.mirrorInfo,
          name,
          url:link,
          covers,
          last_release,
          lang: this.langs[0],
          inLibrary: this.isInLibrary(this.mirrorInfo.name, this.langs[0], link) ? true : false,
        });
      }
      if(cancel) return this.stopListening(socket); // 3rd obligatory check
    } catch(e) {
      this.logger('error while searching mangas', e);
      if(e instanceof Error) socket.emit('searchInMirrors', id, {mirror: this.name, error: 'search_error', trace: e.message});
      else if(typeof e === 'string') socket.emit('searchInMirrors', id, {mirror: this.name, error: 'search_error', trace: e});
      else socket.emit('searchInMirrors', id, {mirror: this.name, error: 'search_error'});
    }
    socket.emit('searchInMirrors', id, { done: true });
    this.stopListening(socket);
  }

  async manga(url:string, lang:string, socket:socketInstance|SchedulerClass, id:number)  {

    // we will check if user don't need results anymore at different intervals
    let cancel = false;
    if(!(socket instanceof SchedulerClass)) {
      socket.once('stopShowManga', () => {
        this.logger('fetching manga canceled');
        cancel = true;
      });
    }

    const link = url.replace(this.host, '');
    const isMangaPage = this.isMangaPage(link);
    if(!isMangaPage) return socket.emit('showManga', id, {error: 'manga_error_invalid_link'});

    const mangaId = `${this.name}/${this.langs[0]}${link}`;

    try {
      const $ = await this.fetch({
        url: `${this.host}${link}`,
        waitForSelector: 'td.name > a',
      }, 'html');
      const name = $('.info-title > h1').text().trim();
      const synopsis = $('.content-info:contains("Summary") > div').text().trim();
      const covers = [];

      if(cancel) return this.stopListening(socket);
      // mangahasu images needs to be downloaded.
      const coverLink = $('.info-img > img').attr('src');
      if(coverLink) {
        const img = await this.downloadImage(coverLink).catch(() => undefined);
        if(img) covers.push(img);
      }

      // getting author(s) and tags
      const authors:string[] = [];
      const tags:string[] = [];

      $('.info-c .detail_item > .row:contains("Author(s)") a').each((i, el) => {
        const author = $(el).text().trim().toLocaleLowerCase();
        if(author.length) authors.push(author);
      });

      $('.info-c .detail_item.row-a:contains("Genre(s)") a').each((i, el) => {
        const tag = $(el).text().trim().toLocaleLowerCase();
        if(tag.length) tags.push(tag);
      });

      const chapters:MangaPage['chapters'] = [];

      for(const [i, el] of $('td.name > a').toArray().reverse().entries()) {
        if(cancel) break;
        const current_chapter = $(el).text().trim();
        const chaplink = $(el).attr('href');
        if(!chaplink) continue;

        let release: MangaPage['chapters'][0] | undefined;
        const date = Date.now(); // dates in manga pages aren't reliable so we use the fetch date instead
        const match = this.getChapterInfoFromString(current_chapter);

        if(match && typeof match === 'object') {
          const [, , , , , , , chapterName] = match;
          release = {
            id: `${mangaId}@${chaplink}`,
            name: chapterName ? chapterName.trim() : current_chapter.replace(/chapter|chap|chaps/gi, '').trim(),
            volume: undefined,
            number: i+1,
            url: chaplink,
            date,
            read: false,
          };
        } else {
          release = {
            id: `${mangaId}@${chaplink}`,
            name: current_chapter.replace(/chapter|chap|chaps/gi, '').trim(),
            number: i+1,
            volume: undefined,
            url: chaplink,
            date,
            read:false,
          };
        }
        if(release) chapters.push(release);
      }
      this.stopListening(socket);
      if(cancel) return;
      return socket.emit('showManga', id, {id: mangaId, url: link, lang: this.langs[0], name, synopsis, covers, authors, tags, chapters: chapters.sort((a,b) => b.number - a.number), inLibrary: false, mirror: this.name });
    } catch(e) {
      this.stopListening(socket);
      this.logger('error while fetching manga', e);
      // we catch any errors because the client needs to be able to handle them
      if(e instanceof Error) return socket.emit('showManga', id, {error: 'manga_error', trace: e.message});
      if(typeof e === 'string') return socket.emit('showManga', id, {error: 'manga_error', trace: e});
      return socket.emit('showManga', id, {error: 'manga_error_unknown'});
    }
  }

  async chapter(url:string, lang:string, socket:socketInstance|SchedulerClass, id:number, callback?: (nbOfPagesToExpect:number)=>void, retryIndex?:number) {
    // we will check if user don't need results anymore at different intervals
    let cancel = false;
    if(!(socket instanceof SchedulerClass)) {
      socket.once('stopShowChapter', () => {
        this.logger('fetching chapter canceled');
        cancel = true;
      });
    }
    const link = url.replace(this.host, '');

    // safeguard, we return an error if the link is not a chapter page
    const isLinkaChapter = this.isChapterPage(link);
    if(!isLinkaChapter) {
      this.stopListening(socket);
      return socket.emit('showChapter', id, {error: 'chapter_error_invalid_link'});
    }

    if(cancel) return this.stopListening(socket);

    try {
      const $ = await this.fetch({
        url: `${this.host}${link}`,
        waitForSelector: '.img-chapter',
      }, 'html');

      // return the number of pages to expect (1-based)
      const nbOfPages = $('.img-chapter img').length;
      if(callback) callback(nbOfPages);

      if(cancel) return this.stopListening(socket);
      for(const [i, el] of $('.img-chapter img').toArray().entries()) {
        if(cancel) break;
        // if the user requested a specific page, we will skip the others
        if(typeof retryIndex === 'number' && i !== retryIndex) continue;

        const imgLink = $(el).attr('src');
        if(imgLink) {
          const img = await this.downloadImage(imgLink, `${this.host}${link}`);
          if(img) {
            socket.emit('showChapter', id, { index: i, src: img, lastpage: i+1 === nbOfPages });
            continue;
          }
        }
        socket.emit('showChapter', id, { error: 'chapter_error_fetch', index: i, lastpage: i+1 === nbOfPages });
      }
      this.stopListening(socket);
    } catch(e) {
      this.stopListening(socket);
      this.logger('error while fetching chapter', e);
      // we catch any errors because the client needs to be able to handle them
      if(e instanceof Error) return socket.emit('showChapter', id, {error: 'chapter_error', trace: e.message});
      if(typeof e === 'string') return socket.emit('showChapter', id, {error: 'chapter_error', trace: e});
      return socket.emit('showChapter', id, {error: 'chapter_error_unknown'});
    }
  }

  async recommend(socket: socketInstance|SchedulerClass, id: number) {
    try {
      // we will check if user don't need results anymore at different intervals
      let cancel = false;
      if(!(socket instanceof SchedulerClass)) {
        socket.once('stopShowRecommend', () => {
          this.logger('fetching recommendations canceled');
          cancel = true;
        });
      }
      const url = `${this.host}/popular-dw.html`;
      const $ = await this.fetch({
        url,
        waitForSelector: '.r_content',
      }, 'html');

      for(const el of $('.list-rank li')) {
        if(cancel) break;
        const link = $('.info-manga > a', el).first().attr('href')?.replace(this.host, '');
        const name = $('.info-manga .name-manga', el).text().trim();
        if((!name || !link) || (link && !this.isMangaPage(link))) continue;
        // mangahasu images needs to be downloaded.
        const covers:string[] = [];
        const coverLink = $('.wrapper_imgage img', el).attr('src');
        if(coverLink) {
          const img = await this.downloadImage(coverLink).catch(() => undefined);
          if(img) covers.push(img);
        }
        // manga id = "mirror_name/lang/link-of-manga-page"
        const mangaId = `${this.name}/${this.langs[0]}${link.replace(this.host, '')}`;

        socket.emit('showRecommend', id, {
          id: mangaId,
          mirrorinfo: this.mirrorInfo,
          name,
          url:link,
          covers,
          lang: this.langs[0],
          inLibrary: this.isInLibrary(this.mirrorInfo.name, this.langs[0], link) ? true : false,
        });
      }
      this.stopListening(socket);
      if(cancel) return;
      socket.emit('showRecommend', id, { done: true });
    } catch(e) {
      this.stopListening(socket);
      this.logger('error while recommending mangas', e);
      if(e instanceof Error) socket.emit('showRecommend', id, {mirror: this.name, error: 'recommend_error', trace: e.message});
      else if(typeof e === 'string') socket.emit('showRecommend', id, {mirror: this.name, error: 'recommend_error', trace: e});
      else socket.emit('showRecommend', id, {mirror: this.name, error: 'recommend_error_unknown'});
      socket.emit('showRecommend', id, { done: true });
    }

  }

  async mangaFromChapterURL(socket: socketInstance, id: number, url: string, lang?: string) {
    // remove the host from the url
    url = url.replace(this.host, '');
    this.althost.forEach(host => url = url.replace(host, ''));
    // if no lang is provided, we will use the default one
    lang = lang||this.langs[0];
    // checking what kind of page this is
    const isMangaPage = this.isMangaPage(url),
          isChapterPage = this.isChapterPage(url);

    if(!isMangaPage && !isChapterPage) return socket.emit('getMangaURLfromChapterURL', id, undefined);
    if(isMangaPage && !isChapterPage) return socket.emit('getMangaURLfromChapterURL', id, {url, lang, mirror: this.name});
    if(isChapterPage) {
      try {
        const $ = await this.fetch({
          url: `${this.host}${url}`,
          waitForSelector: 'body',
        }, 'html');
        const chapterPageURL = $('a[itemprop="url"][href*=html]').attr('href');
        if(chapterPageURL) return socket.emit('getMangaURLfromChapterURL', id, { url: chapterPageURL, lang, mirror: this.name });
        return socket.emit('getMangaURLfromChapterURL', id, undefined);
      } catch {
        return socket.emit('getMangaURLfromChapterURL', id, undefined);
      }
    }
  }
}


const mangahasu = new MangaHasu();
export default mangahasu;

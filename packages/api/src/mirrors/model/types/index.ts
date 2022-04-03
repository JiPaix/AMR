import type { ChapterPage } from '../../types/chapter';
import type { MangaErrorMessage, ChapterErrorMessage, ChapterPageErrorMessage } from '../../types/errorMessages';
import type { MangaPage } from '../../types/manga';
import type { socketInstance } from '../../../routes';

export type MirrorConstructor = {
  /**
   * Time to wait in ms between requests
   */
  waitTime?: number,
  /**
   * mirror icon (import)
   */
  icon: string,
}

export default interface MirrorInterface {
  /**
   * Initialize the mirror
   */
  enabled: boolean;
  /**
   * Mirror full name
   * @example "Manwha "
   */
  displayName: string;
  /**
   * Mirror name slug
   *
   * This is used to generate the mirror route
   * @example
   * ✅ name: 'my_awesome-mirror'
   * ❌ name: 'My Awesome Mirror ©☆'
   */
  name: string;
  /**
   * Mirror website
   * @important no trailing slash
   * @example
   *  ✅ host = 'https://mangadex.org'
   *  ❌ host = 'https://mangadex.org/'
   */
  host: string;
  /**
   * list of options
   */
  options?: { [key:string]: unknown };
  /**
   * Time to wait in ms between requests
   */
  waitTime: number;
  /**
   * The icon of the mirror
   */
  get icon(): string;
  /**
   * Test if url is a manga page
   */
  isMangaPage(url:string): boolean;

  /**
   * Test if url is a chapter page
   */
  isChapterPage(url:string): boolean;

  /**
   * Optional: get volume, chapter number and chapter name from string
   */
  getChapterInfoFromString?(str:string): RegExpExecArray | null

  /**
   * Search manga by name
   * @param {String} query Search string
   * @param {socketInstance} socket user socket
   * @param {Number} id request's uid
   */
  search(query: string, socket:socketInstance, id:number): void;
  /**
   * Returns manga information and chapters
   * @param {String} link link to manga page (Relative URL)
   * @example
   * this.manga("/mangas/one-piece/")
   * //=> https://{mirror.host}/mangas/one-piece/
   */
  manga(link:string): Promise<MangaPage| MangaErrorMessage>

  /**
   * Returns all images from chapter
   * @param link Relative url of chapter page (any page)
   */
  chapter(link: string): Promise<(ChapterPage|ChapterPageErrorMessage)[] | ChapterErrorMessage>

  /**
   * Same as chapter() but for a specific page
   * @param link Relative url of the chapter page
   * @param index the page index, starting from 0
   */
   retryChapterImage(link: string, index:number): Promise<ChapterPage | ChapterPageErrorMessage>
// eslint-disable-next-line semi
}

/** The home page names its own address in its link-preview tags (image, url), so previews work on every domain this runs on. */
export const withOrigin = (html: string, origin: string): string => html.split('__ORIGIN__').join(origin.replace(/\/+$/, ''));

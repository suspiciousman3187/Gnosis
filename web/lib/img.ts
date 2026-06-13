export type ImageImport = string | { src: string };

export function imgSrc(v: ImageImport): string {
  return typeof v === 'string' ? v : v.src;
}

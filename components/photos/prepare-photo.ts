/** Claude reads photos best at up to 1568 px on the long edge, and phones take far larger ones. */
export const MAX_EDGE = 1568;
export const QUALITY = 0.86;

/**
 * Shrinks a camera photo to the size Claude reads, turned upright and
 * saved as JPEG, which also keeps uploads well under the 5 MB limit. A photo
 * the browser cannot decode goes up as it is, and the server checks it.
 */
export async function preparePhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob === null ? reject(new Error("encode failed")) : resolve(blob)), "image/jpeg", QUALITY));
  } catch {
    return file;
  }
}

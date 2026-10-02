export async function pngDimensions(
  image: Blob,
  maxEncoded: number,
  maxRaster: number,
): Promise<{ width: number; height: number }> {
  if (image.type !== "image/png" || image.size < 24 || image.size > maxEncoded)
    throw new Error("Capture requires a bounded PNG image");
  const bytes = new Uint8Array(await image.slice(0, 24).arrayBuffer());
  if (
    ![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82].every(
      (value, index) => bytes[index] === value,
    )
  )
    throw new Error("Invalid PNG header");
  const view = new DataView(bytes.buffer);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height || width * height * 4 > maxRaster)
    throw new Error("Picture exceeds the raster budget");
  return { width, height };
}

export async function validatePictureDecode(
  document: Document,
  image: Blob,
  size: { width: number; height: number },
): Promise<void> {
  const bitmap = await document.defaultView!.createImageBitmap(image);
  try {
    if (bitmap.width !== size.width || bitmap.height !== size.height)
      throw new Error("Decoded picture dimensions changed");
  } finally {
    bitmap.close();
  }
}

// Making our own photos smaller before uploading them.
//
// Phone photos are often 4000+ px and several MB. We redraw them on a <canvas>
// at most 1600 px wide/high (plus a 500 px thumbnail) and save as JPEG.
// Bonus: redrawing removes hidden data like GPS location from the file.

export interface Resized {
  blob: Blob;
  width: number;
  height: number;
}

/** Shrinks an image file so its longest side is at most `maxSize` pixels. */
export async function resizeImage(file: Blob, maxSize: number, quality = 0.85): Promise<Resized> {
  // createImageBitmap decodes the photo; "from-image" keeps phone photos the right way up.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not convert the photo"))), "image/jpeg", quality),
  );
  return { blob, width, height };
}

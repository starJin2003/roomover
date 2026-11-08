import { inflateSync } from "node:zlib";

/** An 8 bit RGB or RGBA PNG, as Playwright writes screenshots, decoded to rows of bytes. */
export interface Png {
  width: number;
  height: number;
  pixel(x: number, y: number): [number, number, number];
}

export function decodePng(buffer: Buffer): Png {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const kind = buffer.toString("ascii", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (kind === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const color = body[9];
      if (body[8] !== 8 || body[12] !== 0 || (color !== 2 && color !== 6)) throw new Error("Unsupported PNG format.");
      channels = color === 2 ? 3 : 4;
    }
    if (kind === "IDAT") data.push(body);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const rows: Uint8Array[] = [];
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const corner = x >= channels ? previous[x - channels] : 0;
      const guess = left + up - corner;
      const paeth =
        Math.abs(guess - left) <= Math.abs(guess - up) && Math.abs(guess - left) <= Math.abs(guess - corner)
          ? left
          : Math.abs(guess - up) <= Math.abs(guess - corner)
            ? up
            : corner;
      const add = [0, left, up, (left + up) >> 1, paeth][filter];
      line[x] = (line[x] + add) & 255;
    }
    rows.push(line);
    previous = line;
  }
  return {
    width,
    height,
    pixel(x, y) {
      const row = rows[y];
      return [row[x * channels], row[x * channels + 1], row[x * channels + 2]];
    },
  };
}

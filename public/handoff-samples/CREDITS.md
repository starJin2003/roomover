# Sample handoff photo credits

These are the sample photos the Handoff screen offers in place of a camera. Each one is derived from the seed listing photo of the same name in `public/seed/listings/`, which carries the Creative Commons CC0 1.0 Universal public domain dedication (https://creativecommons.org/publicdomain/zero/1.0/). The derived files are dedicated to the public domain under CC0 1.0 as well. The original authors and sources are listed in `public/seed/listings/CREDITS.md`.

`pnpm handoff:samples` (`scripts/handoff/make-samples.ts`) writes every file in this folder. It draws each listing photo onto a canvas in Chromium with its own crop (86 to 92 percent of the frame, shifted off center), a turn of 0.8 to 2.4 degrees, and new light (brightness, contrast, and saturation with a warm or cool wash), then saves a JPEG at most 1100 pixels on the long edge. The run is deterministic, so it rewrites the same files.

`marcus-mesh-desk-chair-torn.jpg` is `marcus-mesh-desk-chair.jpg` with a split a few centimeters long drawn into the gray vinyl seat before the crop and light are applied. The tear is drawn by the script and shows damage that the seller's photo does not have.

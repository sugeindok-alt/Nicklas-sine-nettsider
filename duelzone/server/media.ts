import { z } from "zod";
export const imageData = (max: number) =>
  z
    .string()
    .max(Math.ceil((max * 4) / 3) + 100)
    .refine((value) => {
      if (value === "") return true;
      const m =
        /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
          value,
        );
      if (!m) return false;
      const b = Buffer.from(m[2], "base64");
      if (b.length > max || b.length < 12) return false;
      return m[1] === "png"
        ? b
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : m[1] === "jpeg"
          ? b[0] === 255 && b[1] === 216 && b[2] === 255
          : b.toString("ascii", 0, 4) === "RIFF" &&
            b.toString("ascii", 8, 12) === "WEBP";
    }, "Use a valid PNG, JPEG or WebP image within the size limit.");

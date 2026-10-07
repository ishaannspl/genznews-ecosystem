import { ImageResponse } from "next/og";
import { COLORS } from "@/lib/tokens";

export const alt = "GenZNews: Truth First. News Always.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Default font only: nothing is fetched at render time.
export default function Image() {
  const { paper, ink, marker } = COLORS.light;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          background: paper,
          color: ink,
        }}
      >
        <div style={{ fontSize: 176, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1 }}>GenZNews</div>
        <div style={{ display: "flex", marginTop: 40 }}>
          <div
            style={{
              display: "flex",
              fontSize: 52,
              fontWeight: 700,
              padding: "6px 20px",
              background: marker,
              color: ink,
            }}
          >
            Truth First. News Always.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

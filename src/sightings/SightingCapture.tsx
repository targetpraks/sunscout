import {
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  formatSightingAudience,
  formatSightingTimeOfDay,
  SIGHTING_AUDIENCES,
  SIGHTING_CAPTION_MAX_CHARS,
  SIGHTING_TIMES_OF_DAY,
  validateCaptureInput,
  type NewSightingInput,
  type Sighting,
  type SightingAudience,
  type SightingTimeOfDay,
} from "./types";
import { submitSighting } from "./api";

export { submitSighting };

/**
 * Real submit path for the capture flow: fills the client-moderated state
 * (the server requires an explicit moderationState on POST) and POSTs
 * through ./api. Host screens and tests use this so the payload shape is
 * exactly what the sightings router accepts.
 */
export async function postSightingFromCapture(
  input: NewSightingInput,
  submit: (input: NewSightingInput) => Promise<Sighting> = submitSighting,
): Promise<Sighting> {
  return submit({ moderationState: "approved", ...input });
}

export type SightingCaptureProps = {
  beachId: string;
  onSubmit: (input: NewSightingInput) => void | Promise<unknown>;
  /**
   * Uploads the picked blob to storage and resolves the hosted media URL.
   * Injected so this component stays self-contained — the upload pipeline
   * belongs to the host screen.
   */
  onUploadMedia?: (file: File) => Promise<{ url: string; mimeType: string }>;
  onCancel?: () => void;
  submitting?: boolean;
  submitError?: string | null;
  defaults?: {
    mode?: "native" | "link";
    audience?: SightingAudience;
    timeOfDay?: SightingTimeOfDay | null;
    caption?: string;
  };
};

const cardStyle: CSSProperties = {
  background: "#FAF6F0",
  borderRadius: 16,
  padding: 16,
  color: "#0F1E2E",
};

const noteStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: 12,
  color: "#5A6B7A",
};

const errorStyle: CSSProperties = {
  margin: "0 0 8px",
  padding: "8px 10px",
  borderRadius: 8,
  background: "rgba(255,107,92,0.12)",
  color: "#B23A2E",
};

const postedStyle: CSSProperties = {
  margin: "0 0 8px",
  padding: "8px 10px",
  borderRadius: 8,
  background: "rgba(46,139,107,0.12)",
  color: "#2E8B6B",
};

const fieldStyle: CSSProperties = {
  display: "block",
  margin: "10px 0 0",
  fontSize: 13,
};

const inputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(15,30,46,0.15)",
  background: "#FFFFFF",
  color: "#0F1E2E",
  boxSizing: "border-box",
};

const primaryButtonStyle: CSSProperties = {
  marginTop: 14,
  padding: "10px 16px",
  borderRadius: 999,
  border: "none",
  background: "#0A6E78",
  color: "#FFFFFF",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  marginTop: 14,
  marginLeft: 8,
  padding: "10px 16px",
  borderRadius: 999,
  border: "1px solid rgba(15,30,46,0.2)",
  background: "transparent",
  color: "#0F1E2E",
  cursor: "pointer",
};

export function SightingCapture({
  beachId,
  onSubmit,
  onUploadMedia,
  onCancel,
  submitting = false,
  submitError = null,
  defaults,
}: SightingCaptureProps) {
  const [mode, setMode] = useState<"native" | "link">(
    defaults?.mode ?? "native",
  );
  const [audience, setAudience] = useState<SightingAudience | "">(
    defaults?.audience ?? "",
  );
  const [timeOfDay, setTimeOfDay] = useState<SightingTimeOfDay | "">(
    defaults?.timeOfDay ?? "",
  );
  const [caption, setCaption] = useState(defaults?.caption ?? "");
  const [nativeFile, setNativeFile] = useState<File | null>(null);
  const [nativePreviewUrl, setNativePreviewUrl] = useState<string | null>(null);
  const [socialPlatform, setSocialPlatform] = useState<"tiktok" | "instagram">(
    "tiktok",
  );
  const [socialUrl, setSocialUrl] = useState("");
  const [attribution, setAttribution] = useState("");
  const [peopleInFrame, setPeopleInFrame] = useState(false);
  const [peopleConsent, setPeopleConsent] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [posted, setPosted] = useState(false);

  const busy = submitting || uploading;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setNativeFile(file);
    setIssues([]);
    if (
      nativePreviewUrl &&
      typeof URL !== "undefined" &&
      typeof URL.revokeObjectURL === "function"
    ) {
      URL.revokeObjectURL(nativePreviewUrl);
    }
    // Object URLs only exist in a real browser; this handler never runs
    // during static rendering, so the guard is defence in depth.
    if (
      file &&
      typeof URL !== "undefined" &&
      typeof URL.createObjectURL === "function"
    ) {
      setNativePreviewUrl(URL.createObjectURL(file));
    } else {
      setNativePreviewUrl(null);
    }
  };

  const buildInput = (
    nativeMediaUrl: string,
    nativeMediaMime: string,
  ): NewSightingInput => ({
    beachId,
    // An empty audience is cast through so validateCaptureInput can flag it.
    audience: audience as SightingAudience,
    timeOfDay: timeOfDay === "" ? null : timeOfDay,
    consent: { peopleInFrame, peopleConsent },
    caption: caption.trim() ? caption.trim() : null,
    ...(mode === "native"
      ? { nativeMedia: { url: nativeMediaUrl, mimeType: nativeMediaMime } }
      : {
          socialLink: {
            platform: socialPlatform,
            url: socialUrl.trim(),
            attribution: attribution.trim(),
          },
        }),
  });

  const resetForm = () => {
    setMode("native");
    setAudience("");
    setTimeOfDay("");
    setCaption("");
    setNativeFile(null);
    setNativePreviewUrl(null);
    setSocialPlatform("tiktok");
    setSocialUrl("");
    setAttribution("");
    setPeopleInFrame(false);
    setPeopleConsent(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setIssues([]);
    setPosted(false);

    let input: NewSightingInput;
    if (mode === "native") {
      if (!nativeFile) {
        setIssues(["Choose a photo or video to share."]);
        return;
      }
      if (!onUploadMedia) {
        setIssues([
          "Media uploads are not available in this client right now.",
        ]);
        return;
      }
      setUploading(true);
      let uploaded: { url: string; mimeType: string };
      try {
        uploaded = await onUploadMedia(nativeFile);
      } catch {
        setUploading(false);
        setIssues(["The upload failed — please try again."]);
        return;
      }
      setUploading(false);
      input = buildInput(uploaded.url, uploaded.mimeType || nativeFile.type);
    } else {
      input = buildInput("", "");
    }

    const validation = validateCaptureInput(input);
    if (!validation.ok) {
      setIssues(validation.issues);
      return;
    }

    try {
      await onSubmit(input);
      resetForm();
      setPosted(true);
    } catch {
      // The host screen surfaces failures through the submitError prop.
    }
  };

  return (
    <form
      className="sighting-capture"
      style={cardStyle}
      onSubmit={handleSubmit}
      aria-label="Share a sighting"
    >
      <h3 className="sighting-capture-heading">Share a sighting</h3>
      <p className="sighting-capture-note" style={noteStyle}>
        Sightings keep this beach honest about right now. Photos and videos
        disappear 7 days after posting.
      </p>

      {submitError ? (
        <p className="sighting-capture-error" style={errorStyle} role="alert">
          {submitError}
        </p>
      ) : null}
      {issues.length > 0 ? (
        <ul className="sighting-capture-issues" style={errorStyle} role="alert">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      {posted ? (
        <p
          className="sighting-capture-posted"
          style={postedStyle}
          role="status"
        >
          Posted — this sighting disappears in 7 days.
        </p>
      ) : null}

      <fieldset
        className="sighting-mode"
        style={{ border: "none", margin: "12px 0 0", padding: 0 }}
      >
        <legend style={{ fontSize: 13, padding: 0 }}>
          What are you sharing?
        </legend>
        <label style={{ display: "block", margin: "6px 0 0", fontSize: 13 }}>
          <input
            type="radio"
            name="sighting-mode"
            value="native"
            checked={mode === "native"}
            onChange={() => setMode("native")}
            disabled={busy}
          />{" "}
          Photo / video — expires in 7 days
        </label>
        <label style={{ display: "block", margin: "6px 0 0", fontSize: 13 }}>
          <input
            type="radio"
            name="sighting-mode"
            value="link"
            checked={mode === "link"}
            onChange={() => setMode("link")}
            disabled={busy}
          />{" "}
          TikTok / Instagram link — stays as a creator credit
        </label>
      </fieldset>

      {mode === "native" ? (
        <div className="sighting-native-fields">
          <label className="sighting-native-label" style={fieldStyle}>
            Photo or video of the beach
            <input
              type="file"
              accept="image/*,video/*"
              onChange={handleFileChange}
              disabled={busy}
              aria-label="Photo or video of the beach"
              style={inputStyle}
            />
          </label>
          {nativeFile ? (
            <div className="sighting-file-chip" style={noteStyle}>
              {nativePreviewUrl && nativeFile.type.startsWith("image/") ? (
                <img
                  src={nativePreviewUrl}
                  alt=""
                  style={{
                    width: 64,
                    height: 64,
                    objectFit: "cover",
                    borderRadius: 8,
                    marginRight: 8,
                  }}
                />
              ) : null}
              <span>
                {nativeFile.name} · {nativeFile.type || "unknown type"} —
                ephemeral, disappears 7 days after you post.
              </span>
            </div>
          ) : (
            <p className="sighting-native-note" style={noteStyle}>
              Native media lives for 7 days, then vanishes — that keeps the
              &ldquo;is this beach alive right now&rdquo; signal fresh.
            </p>
          )}
        </div>
      ) : (
        <div className="sighting-link-fields">
          <label className="sighting-platform-label" style={fieldStyle}>
            Platform
            <select
              value={socialPlatform}
              onChange={(event) =>
                setSocialPlatform(event.target.value as "tiktok" | "instagram")
              }
              disabled={busy}
              aria-label="Social platform"
              style={inputStyle}
            >
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
            </select>
          </label>
          <label className="sighting-url-label" style={fieldStyle}>
            Post URL
            <input
              type="url"
              placeholder="https://www.tiktok.com/@creator/video/123"
              value={socialUrl}
              onChange={(event) => setSocialUrl(event.target.value)}
              disabled={busy}
              aria-label="Social post URL"
              style={inputStyle}
            />
          </label>
          <label className="sighting-attribution-label" style={fieldStyle}>
            Creator handle
            <input
              type="text"
              placeholder="@creator"
              value={attribution}
              onChange={(event) => setAttribution(event.target.value)}
              disabled={busy}
              aria-label="Creator handle"
              style={inputStyle}
            />
          </label>
          <p className="sighting-link-note" style={noteStyle}>
            SunScout links out to the original post and credits the creator — it
            never re-hosts their media.
          </p>
        </div>
      )}

      <label className="sighting-audience-label" style={fieldStyle}>
        Who is this for? (required)
        <select
          value={audience}
          onChange={(event) =>
            setAudience(event.target.value as SightingAudience | "")
          }
          required
          disabled={busy}
          aria-label="Audience"
          style={inputStyle}
        >
          <option value="" disabled>
            Choose an audience
          </option>
          {SIGHTING_AUDIENCES.map((option) => (
            <option key={option} value={option}>
              {formatSightingAudience(option)}
            </option>
          ))}
        </select>
      </label>

      <label className="sighting-time-label" style={fieldStyle}>
        Time of day (optional)
        <select
          value={timeOfDay}
          onChange={(event) =>
            setTimeOfDay(event.target.value as SightingTimeOfDay | "")
          }
          disabled={busy}
          aria-label="Time of day"
          style={inputStyle}
        >
          <option value="">Any time</option>
          {SIGHTING_TIMES_OF_DAY.map((option) => (
            <option key={option} value={option}>
              {formatSightingTimeOfDay(option)}
            </option>
          ))}
        </select>
      </label>

      <label className="sighting-caption-label" style={fieldStyle}>
        Caption (optional)
        <textarea
          rows={2}
          maxLength={SIGHTING_CAPTION_MAX_CHARS}
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          disabled={busy}
          aria-label="Caption"
          style={inputStyle}
        />
      </label>
      <span className="sighting-caption-counter" style={noteStyle}>
        {caption.length}/{SIGHTING_CAPTION_MAX_CHARS}
      </span>

      <fieldset
        className="sighting-consent"
        style={{ border: "none", margin: "12px 0 0", padding: 0 }}
      >
        <legend style={{ fontSize: 13, padding: 0 }}>Consent</legend>
        <label style={{ display: "block", margin: "6px 0 0", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={peopleInFrame}
            onChange={(event) => setPeopleInFrame(event.target.checked)}
            disabled={busy}
          />{" "}
          People are recognizable in this sighting
        </label>
        <label style={{ display: "block", margin: "6px 0 0", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={peopleConsent}
            onChange={(event) => setPeopleConsent(event.target.checked)}
            disabled={busy}
          />{" "}
          Everyone shown agreed to be posted
        </label>
      </fieldset>

      <button type="submit" disabled={busy} style={primaryButtonStyle}>
        {busy ? "Posting…" : "Post sighting"}
      </button>
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={secondaryButtonStyle}
        >
          Cancel
        </button>
      ) : null}
    </form>
  );
}

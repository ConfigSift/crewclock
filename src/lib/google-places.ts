let googlePlacesPromise: Promise<void> | null = null;

const GOOGLE_MAPS_SCRIPT_SELECTOR =
  'script[data-google-maps-places="true"]';
const GOOGLE_MAPS_STATUS_ATTR = "data-google-maps-places-status";

export function loadGooglePlaces(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("Google Places can only be loaded in the browser")
    );
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return Promise.reject(
      new Error("Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY")
    );
  }

  const win = window as Window & {
    google?: {
      maps?: {
        places?: unknown;
      };
    };
  };

  if (win.google?.maps?.places) {
    return Promise.resolve();
  }

  if (googlePlacesPromise) {
    return googlePlacesPromise;
  }

  googlePlacesPromise = new Promise<void>((resolve, reject) => {
    const rejectLoad = (message: string) => {
      googlePlacesPromise = null;
      reject(new Error(message));
    };

    const resolveIfReady = () => {
      if (win.google?.maps?.places) {
        resolve();
        return true;
      }
      return false;
    };

    const attachListeners = (script: HTMLScriptElement) => {
      const onLoad = () => {
        script.setAttribute(GOOGLE_MAPS_STATUS_ATTR, "loaded");
        if (!resolveIfReady()) {
          rejectLoad("Google Places API loaded without places library");
        }
      };

      const onError = () => {
        script.setAttribute(GOOGLE_MAPS_STATUS_ATTR, "error");
        rejectLoad("Failed to load Google Places API");
      };

      script.addEventListener("load", onLoad, { once: true });
      script.addEventListener("error", onError, { once: true });
    };

    if (resolveIfReady()) return;

    const existingScript = document.querySelector<HTMLScriptElement>(
      GOOGLE_MAPS_SCRIPT_SELECTOR
    );

    if (existingScript) {
      const status = existingScript.getAttribute(GOOGLE_MAPS_STATUS_ATTR);
      if (status === "loaded") {
        if (!resolveIfReady()) {
          rejectLoad("Google Places API loaded without places library");
        }
        return;
      }

      if (status === "error") {
        rejectLoad("Failed to load Google Places API");
        return;
      }

      const existingReadyState = (existingScript as HTMLScriptElement & {
        readyState?: string;
      }).readyState;
      if (existingReadyState === "complete") {
        if (!resolveIfReady()) {
          rejectLoad("Google Places API loaded without places library");
        }
        return;
      }

      attachListeners(existingScript);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMapsPlaces = "true";
    script.setAttribute(GOOGLE_MAPS_STATUS_ATTR, "loading");

    attachListeners(script);
    document.head.appendChild(script);
  });

  return googlePlacesPromise;
}

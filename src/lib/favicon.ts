import "server-only";
import { hostname } from "./format";

// Off with a blank FAVICON_SERVICE: the initial shows instead. E2E points it at a local stub.
const service = () => process.env.FAVICON_SERVICE ?? "https://icons.duckduckgo.com/ip3";

/** The favicon of the site of `url`, through api/favicon; null when there is none to ask for. */
export function faviconUrl(url: string | undefined) {
  const host = url && hostname(url);
  return service() && host ? `/api/favicon/${host}` : null;
}

/** Where the service keeps `host`'s favicon; null for anything that is not a host name. */
export function faviconSource(host: string) {
  return service() && /^[a-z0-9.-]{1,253}$/i.test(host) ? `${service()}/${host}.ico` : null;
}

/** Enable only the reviewed continuation flow on a configured production deployment. */
export function h3ContinuationEnabled() {
  return process.env.OTG_ENV === "test" ||
    (process.env.OTG_ENV === "prod" && process.env.OTG_H3_CONTINUATION_ENABLED === "1");
}

export function timelineEditorEnabled() {
  const environment = process.env.OTG_ENV;
  return environment === "test" || environment === "prod";
}

export const metadata = {
  title: "SLR Studios — AI-assisted creative studio",
  description: "Plan stories, create characters, and work with images, video and audio in SLR Studios. Learn how optional Google connections work.",
  alternates: {canonical: "https://comf-otg.comfyui-otg.win/about"},
  robots: {index: process.env.OTG_ENV === "prod", follow: true},
};
export default function AboutPage() {
  return <article>
    <p><small>YOUR IDEAS. YOUR CHARACTERS. YOUR STUDIO.</small></p>
    <h1>Create with SLR Studios.</h1>
    <p>SLR Studios is an AI-assisted creative workspace for planning stories and working with images, video, characters and audio. Use it in your browser or through the SLR Studios Android app.</p>
    <h2>From an idea to your next scene</h2>
    <ul><li>Develop stories, prompts, characters and reusable visual references.</li><li>Generate and edit images, build video shots and compare takes.</li><li>Create character voices and work with dialogue and other audio.</li><li>Save uploaded assets and completed media for later use.</li></ul>
    <p>Available tools depend on your account, selected models and administrator configuration. Experimental tools and Production v.2 are not promises of generally available functionality. AI results need your review.</p>
    <h2>Optional Google Photos connection</h2>
    <p>Connecting Google Photos lets you choose specific photos or videos to import into a project. It does not give SLR Studios unrestricted access to your photo library. You can use phone storage without connecting Google Photos.</p>
    <p>Imported copies can be stored with your projects and used by the editing or generation tools you request. Connecting Google Photos is not Google account sign-in for SLR Studios and does not automatically save your projects to your own Google Drive.</p>
    <h2>Administrator-managed Google Drive backups</h2>
    <p>The separate SLR Drive Backup connection allows the studio administrator to keep encrypted recovery copies of studio data in the administrator-authorized Drive account. It requests access to files the backup application creates or that are explicitly shared with it, not unrestricted access to everyone’s Drive.</p>
    <p>Backup completion is tracked separately from account connection. Historical recovery copies can remain after local files are removed. See the <a href="/privacy">privacy policy</a> for storage, access and deletion details.</p>
    <h2>Start creating</h2>
    <p><a href="/app">Open SLR Studios</a>. Before uploading personal media or connecting Google, read our <a href="/privacy">privacy policy</a> and <a href="/terms">terms of service</a>.</p>
  </article>;
}

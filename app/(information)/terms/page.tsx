export const metadata = {
  title: "Terms of service — SLR Studios",
  description: "Terms for using SLR Studios creative tools and optional Google integrations.",
  alternates: {canonical: "https://comf-otg.comfyui-otg.win/terms"},
  robots: {index: process.env.OTG_ENV === "prod", follow: true},
};
export default function TermsPage() {
  return <article>
    <h1>Terms of service</h1><p><small>SLR Studios · Effective November 3, 2026</small></p>
    <p>These terms describe use of the SLR Studios web app and Android wrapper. Read them together with the <a href="/privacy">privacy policy</a>. Questions can be sent to <a href="mailto:slrochford123@gmail.com">slrochford123@gmail.com</a>.</p>
    <h2>Your account and access</h2>
    <p>Keep your account secure and use only features and resources you are authorized to access. Do not share credentials, bypass permissions, interfere with other users’ jobs or attempt to access their private files. SLR Studios is not directed to children under 13; additional age and access restrictions may apply to individual features.</p>
    <h2>Your content and permissions</h2>
    <p>You retain the rights you have in your uploaded content. Providing it to SLR Studios authorizes the processing, storage, transmission and recovery copies needed to carry out your requested actions and operate the service, as described in the privacy policy. This does not transfer ownership of your content to SLR Studios.</p>
    <p>Upload or generate content only when you have the necessary rights and consent. This includes permission to use a person’s likeness or voice. Do not create unlawful content, non-consensual intimate imagery, sexual content involving minors, fraudulent impersonations or material that violates another person’s rights.</p>
    <h2>AI results and review</h2>
    <p>AI outputs can contain mistakes, artifacts, inconsistent identities or unexpected content. Review results before sharing or relying on them. A generated result does not establish ownership, copyright protection, factual accuracy or permission to use another person’s likeness. Model and provider terms may impose additional limits on use, including commercial use.</p>
    <h2>Optional integrations and costs</h2>
    <p>Google connections are optional and subject to Google’s authorization controls. Connecting Google Photos imports only selected media; it does not make Google responsible for SLR Studios or automatically back up your work to your own Drive.</p>
    <p>External AI services and other optional features may have usage costs and separate provider terms. Review applicable costs and approval controls before requesting a paid operation. These terms do not by themselves authorize a new subscription or charge.</p>
    <h2>Availability and your copies</h2>
    <p>Processing can be delayed or fail because of hardware capacity, service outages or model limitations. Test and experimental features can change. No particular result, completion time, uninterrupted availability or complete backup is guaranteed. Keep your own copies of important work and check the actual completion status of exports and backups.</p>
    <h2>Removal, support and changes</h2>
    <p>Use available removal and account-deletion controls, or contact support for help with assets and recovery copies. Historical backups have separate retention and deletion handling, explained in the privacy policy. Access may be restricted to protect the service or address misuse, with notice where appropriate.</p>
    <p>Material changes to these terms will be identified with an updated effective date and notice where appropriate. Nothing here removes rights or remedies that applicable law does not allow to be excluded.</p>
  </article>;
}

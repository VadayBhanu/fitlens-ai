import { Link } from "react-router-dom";

const UPDATED = "October 24, 2026";

export function Privacy() {
  return (
    <div className="container prose stack">
      <h1 style={{ fontSize: 40 }}>Privacy Policy</h1>
      <p className="muted small">Last updated {UPDATED}. This policy describes how the FitLens service handles your data. Operators deploying FitLens should have it reviewed by counsel for their jurisdiction.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account data:</strong> your email, optional display name and a salted password hash.</li>
        <li><strong>Photos you upload</strong> for try-on, and the images we generate from them.</li>
        <li><strong>Products you select:</strong> the product details a store publishes on the page where you click FitLens (name, brand, color, size, price, identifiers, image URL).</li>
        <li><strong>Media you save:</strong> captures, recordings and reels you choose to save to your wardrobe.</li>
        <li><strong>Operational records:</strong> usage counts (for daily limits), security audit events with a hashed IP address, and consent records.</li>
      </ul>

      <h2>What we don't collect</h2>
      <ul>
        <li>The Live Mirror processes your camera <strong>on your device</strong>. Camera frames are not uploaded unless you save a capture or recording.</li>
        <li>The browser extension does not read pages in the background. It only reads a page after you click the FitLens button on that tab.</li>
        <li>We don't sell your data or use your photos to train models.</li>
      </ul>

      <h2>Third-party processing</h2>
      <p>
        When you start a photo try-on, after you give explicit consent, your photo and the garment image are sent to our virtual try-on provider (FASHN AI) to generate the result. The generated
        image is copied into our private storage. Data is hosted on Cloudflare (Workers, D1, R2). If price comparison is enabled, product search terms (not your photos) may be sent to a shopping
        data provider.
      </p>

      <h2>Retention</h2>
      <table className="simple">
        <tbody>
          <tr><th>Live camera frames</th><td>Not stored</td></tr>
          <tr><th>Uploaded source photos</th><td>Deleted automatically after 24 hours unless you choose to keep them</td></tr>
          <tr><th>Try-on results, captures, reels</th><td>Kept until you delete them or your account</td></tr>
          <tr><th>Sessions</th><td>Expire after 30 days</td></tr>
          <tr><th>Usage and audit records</th><td>Kept while your account exists, deleted with your account (anonymized audit entries may remain for security)</td></tr>
        </tbody>
      </table>

      <h2>Your controls</h2>
      <ul>
        <li>Withdraw cloud try-on consent at any time in <Link to="/account">Account</Link>.</li>
        <li>Delete individual photos and looks, export all your data as JSON, or permanently delete your account and all stored media.</li>
      </ul>

      <h2>Age</h2>
      <p>FitLens is for adults (18+). Don't upload photos of minors or of anyone who hasn't agreed.</p>

      <h2>Contact</h2>
      <p>Questions or deletion requests: contact the operator of this FitLens deployment.</p>
    </div>
  );
}

export function Terms() {
  return (
    <div className="container prose stack">
      <h1 style={{ fontSize: 40 }}>Terms of Service</h1>
      <p className="muted small">Last updated {UPDATED}. Template terms; have them reviewed before public launch.</p>
      <h2>Acceptable use</h2>
      <ul>
        <li>Only upload photos of yourself or of adults who have given you permission.</li>
        <li>Don't use FitLens to create sexualized, deceptive or harassing images, or to impersonate anyone.</li>
        <li>Don't attempt to bypass usage limits, scrape the service or attack its security.</li>
      </ul>
      <h2>AI-generated previews</h2>
      <p>
        Try-on images are AI-generated visualizations. They may not exactly reproduce a garment's color, pattern, logo, fabric or fit, and they are not a sizing recommendation. Always check the
        retailer's product details, size chart and return policy before buying.
      </p>
      <h2>Prices and offers</h2>
      <p>
        Offer information comes from third-party sources and may be out of date. We show where each price came from and when it was checked. Purchases happen on the retailer's site, under the retailer's
        terms.
      </p>
      <h2>Your content</h2>
      <p>You keep ownership of your photos. You give us a limited license to process them only to provide the service you request.</p>
      <h2>Availability</h2>
      <p>The service is provided "as is". Free usage is subject to daily limits that may change.</p>
    </div>
  );
}

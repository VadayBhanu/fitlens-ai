import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="container stack" style={{ padding: "60px 16px" }}>
      <h2>Page not found</h2>
      <p className="muted">That page doesn't exist.</p>
      <div><Link className="btn btn-primary" to="/">Go home</Link></div>
    </div>
  );
}

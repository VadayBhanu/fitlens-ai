import { useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Logo } from "./ui";

export function Layout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div className="shell">
      <a className="sr-only" href="#content">Skip to content</a>
      <header className="nav">
        <div className="container nav-inner">
          <Link to="/" className="brand" onClick={close}>
            <Logo /> FitLens
          </Link>
          <button className="btn btn-ghost btn-icon nav-toggle" aria-expanded={open} aria-controls="nav-links" onClick={() => setOpen(!open)}>
            <span aria-hidden="true">☰</span>
            <span className="sr-only">Menu</span>
          </button>
          <nav id="nav-links" className={`nav-links${open ? " open" : ""}`} aria-label="Main">
            <NavLink to="/studio" onClick={close}>Try-On Studio</NavLink>
            <NavLink to="/mirror" onClick={close}>Live Mirror</NavLink>
            <NavLink to="/wardrobe" onClick={close}>Wardrobe</NavLink>
            {user ? (
              <NavLink to="/account" onClick={close}>Account</NavLink>
            ) : (
              <>
                <NavLink to="/login" onClick={close}>Sign in</NavLink>
                <Link className="btn btn-primary btn-sm" to="/signup" onClick={close}>Get started</Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="content">{children}</main>
      <footer className="site">
        <div className="container row between">
          <span>© {new Date().getFullYear()} FitLens AI</span>
          <span className="row">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <a href="/demo-store/">Demo store</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

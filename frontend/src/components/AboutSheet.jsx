// Help and about: how to use the app, ownership, copyright, version, and the
// attributions the app's data sources require. Opened from Help in the menu
// and from the sign-in page.
import React from "react";
import { getServerUrl } from "../lib/api.js";
import SheetClose from "./SheetClose.jsx";

export const OWNER = "Musara Holdings LLC";
export const COPYRIGHT = `© 2026 ${OWNER}. All rights reserved.`;

export default function AboutSheet({ onClose, user }) {
  const native = !!window.Capacitor?.isNativePlatform?.();
  const server = getServerUrl() || window.location.origin;

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel about" onClick={(e) => e.stopPropagation()}>
        <SheetClose onClose={onClose} />
        <div className="about-mark">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
            <path d="M11 20A7 7 0 019.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 2 8 0 5.5-4.8 10-10 10z" />
            <path d="M2 21c0-3 1.9-5.5 4.5-6.3" />
          </svg>
        </div>
        <h2>Woodlands Farm Manager</h2>
        <div className="code">Version {__APP_VERSION__}{native ? " · Android app" : " · Web app"}</div>

        <div className="section-title">Help</div>
        <ul className="about-text help-list">
          <li><b>Tasks</b>: tap a task, record the numbers and photos it asks for, then Done. It works with no signal.</li>
          <li><b>Notes</b>: anything worth recording that isn&apos;t a task, with photos, video or a voice note.</li>
          <li><b>Syncing</b>: the badge at the top shows what is waiting; tap it to see each upload and retry.</li>
          <li><b>Review</b> (owner and task manager): accept finished work, or send it back with a reason.</li>
          <li><b>Field Walk</b>: the walking and scouting tasks due today. <b>Logs</b>: everything recorded.</li>
        </ul>

        <div className="about-owner">
          <div className="about-owner-label">Owned by</div>
          <div className="about-owner-name">{OWNER}</div>
        </div>

        <p className="about-text">
          Woodlands Farm Manager, including its software, design, task templates and
          documentation, is the property of {OWNER} and is protected by copyright law.
          No part of it may be copied, modified or distributed without written
          permission from {OWNER}.
        </p>

        <div className="section-title">This device</div>
        <div className="card">
          <div className="kv"><span>Server</span><b className="about-wrap">{server}</b></div>
          {user && <div className="kv"><span>Signed in as</span><b className="about-wrap">{user.email}</b></div>}
          {user && <div className="kv"><span>Role</span><b style={{ textTransform: "capitalize" }}>{user.role}</b></div>}
        </div>

        <div className="section-title">Credits</div>
        <p className="about-text small">
          Weather forecasts by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a>,
          licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>.
          Typefaces DM Sans and Fraunces under the SIL Open Font License.
        </p>

        <p className="about-copyright">{COPYRIGHT}</p>
        <button type="button" className="btn ghost block" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

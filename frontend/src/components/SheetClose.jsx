// The × in the corner of every sheet: tapping outside also closes, but that
// isn't obvious, so each sheet has a visible, labelled close button.
import React from "react";

export default function SheetClose({ onClose }) {
  return <button type="button" className="sheet-x" aria-label="Close" onClick={onClose}>×</button>;
}

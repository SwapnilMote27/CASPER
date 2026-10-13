import { Link } from "react-router-dom";

import "./BackToDashboard.css";

// Reusable "Back to Dashboard" button.
// to        route of your Dashboard page (check the path in App.jsx)
// variant   "light" for the formal scientific pages, "dark" for Live Earth
// floating  true to pin it over a full-screen page (Live Earth)
function BackToDashboard({ to = "/", variant = "light", floating = false }) {
  const classes = [
    "back-button",
    `back-button--${variant}`,
    floating ? "back-button--floating" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link to={to} className={classes}>
      <span aria-hidden="true">←</span>
      Back to Dashboard
    </Link>
  );
}

export default BackToDashboard;
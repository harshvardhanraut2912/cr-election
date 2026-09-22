import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import StudentVote from "./pages/StudentVote/StudentVote.jsx";
import AdminTV from "./pages/AdminTV/AdminTV.jsx";
import AdminSettings from "./pages/AdminSettings/AdminSettings.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/student/vote" replace />} />
        <Route path="/student/vote" element={<StudentVote />} />
        <Route path="/admin/tv" element={<AdminTV />} />
        <Route path="/admin/settings" element={<AdminSettings />} />
        <Route path="*" element={<div style={{ padding: 24 }}>Page not found</div>} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);

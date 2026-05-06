import { useEffect, useState, useCallback } from "react";
import "./App.css";

const API = window.location.origin + "/api";

function Histogram({ email }) {
  const bodyLength = email.body?.length || 0;
  const attachmentsSize = email.attachments?.reduce((acc, att) => acc + (att.size || 0), 0) || 0;
  const wordCount = email.body ? email.body.trim().split(/\s+/).length : 0;

  // Нормализация высоты (макс 30px)
  const maxVal = Math.max(bodyLength / 100, attachmentsSize / 1024, wordCount, 1);
  const h1 = Math.max((bodyLength / 100 / maxVal) * 30, 2);
  const h2 = Math.max(((attachmentsSize / 1024) / maxVal) * 30, 2);
  const h3 = Math.max((wordCount / maxVal) * 30, 2);

  return (
    <div className="histogram">
      <div
        className="histogram-bar"
        data-type="body"
        style={{ height: `${h1}px` }}
        data-tooltip={`Символов: ${bodyLength}`}
      ></div>
      <div
        className="histogram-bar"
        data-type="attach"
        style={{ height: `${h2}px` }}
        data-tooltip={`Вложения: ${(attachmentsSize / 1024).toFixed(1)} КБ`}
      ></div>
      <div
        className="histogram-bar"
        data-type="word"
        style={{ height: `${h3}px` }}
        data-tooltip={`Слов: ${wordCount}`}
      ></div>
    </div>
  );
}

function App() {
  // ─── Auth state ──────────────────────────────────────────────────────────────
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [userEmail, setUserEmail] = useState(localStorage.getItem("userEmail") || "");
  const [authMode, setAuthMode] = useState("login"); // "login" | "register"
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // ─── App state ───────────────────────────────────────────────────────────────
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState("inbox");
  const [lastListView, setLastListView] = useState("inbox");
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [composeData, setComposeData] = useState({ recipient_email: "", subject: "", body: "" });
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [dragging, setDragging] = useState(false);

  // ─── Авторизованный fetch ────────────────────────────────────────────────────
  const authFetch = useCallback((url, options = {}) => {
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        "Authorization": `Bearer ${token}`,
      },
    }).then(res => {
      if (res.status === 401) {
        // Токен истёк — разлогиниваем
        handleLogout();
        throw new Error("Session expired");
      }
      return res;
    });
  }, [token]);

  // ─── Auth handlers ───────────────────────────────────────────────────────────
  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    try {
      console.log("Starting auth process...", { authMode, authEmail });

      if (authMode === "register") {
        const regRes = await fetch(`${API}/register`, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: authEmail.trim(), password: authPassword }),
        });

        if (!regRes.ok) {
          const regData = await regRes.json();
          throw new Error(regData.detail || "Registration failed");
        }
        console.log("Registration successful");
      }

      // Логин
      const formData = new URLSearchParams();
      formData.append("username", authEmail.trim());
      formData.append("password", authPassword);

      const logRes = await fetch(`${API}/token`, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData,
      });

      if (!logRes.ok) {
        const logData = await logRes.json();
        throw new Error(logData.detail || "Login failed");
      }

      const data = await logRes.json();
      console.log("Login successful, token received");

      if (data.access_token) {
        localStorage.setItem("token", data.access_token);
        localStorage.setItem("userEmail", authEmail.trim());
        setToken(data.access_token);
        setUserEmail(authEmail.trim());
        setAuthEmail("");
        setAuthPassword("");
      } else {
        throw new Error("No token received from server");
      }
    } catch (err) {
      console.error("Auth Error:", err);
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("userEmail");
    setToken("");
    setUserEmail("");
    setEmails([]);
    setCurrentView("inbox");
  };

  // ─── Загрузка писем ──────────────────────────────────────────────────────────
  const fetchEmails = useCallback((background = false) => {
    if (!token) return;
    if (!background) setLoading(true);

    const folder = (currentView === "sent") ? "sent" : "inbox";

    authFetch(`${API}/emails?folder=${folder}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        setEmails(data);
        if (!background) setLoading(false);
      })
      .catch(err => {
        console.error("Error fetching emails:", err);
        if (!background) setLoading(false);
      });
  }, [token, currentView, authFetch]);

  useEffect(() => {
    if (!token) return;
    if (currentView === "inbox" || currentView === "sent") {
      setLastListView(currentView);
      fetchEmails(false);

      const interval = setInterval(() => fetchEmails(true), 5000);
      return () => clearInterval(interval);
    }
  }, [token, currentView, fetchEmails]);

  // ─── Отправка письма ─────────────────────────────────────────────────────────
  const handleSendEmail = (e) => {
    e.preventDefault();
    setSending(true);

    const formData = new FormData();
    formData.append("recipient_email", composeData.recipient_email);
    formData.append("subject", composeData.subject);
    formData.append("body", composeData.body);
    attachments.forEach((file) => formData.append("files", file));

    authFetch(`${API}/emails`, { method: "POST", body: formData })
      .then(res => {
        if (!res.ok) throw new Error("Failed to send");
        return res.json();
      })
      .then(() => {
        setComposeData({ recipient_email: "", subject: "", body: "" });
        setAttachments([]);
        setCurrentView("inbox");
        setSending(false);
      })
      .catch(err => {
        console.error(err);
        alert("Ошибка при отправке");
        setSending(false);
      });
  };

  // ─── Отметка прочитанного ────────────────────────────────────────────────────
  const markAsRead = (emailId) => {
    authFetch(`${API}/emails/${emailId}/read`, { method: "PUT" }).catch(console.error);
    setEmails(emails.map(e => e.id === emailId ? { ...e, is_read: true } : e));
  };

  // ─── Скачивание вложений (через fetch + blob, чтобы передать токен) ─────────
  const downloadAttachment = (attId, filename) => {
    authFetch(`${API}/attachments/${attId}/download`)
      .then(res => {
        if (!res.ok) throw new Error("Download failed");
        return res.blob();
      })
      .then(blob => {
        if (!(blob instanceof Blob)) {
          throw new Error("Received data is not a valid file");
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a); // Важно для Firefox
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(err => {
        console.error("Download error:", err);
        alert("Ошибка при скачивании файла");
      });
  };

  // ─── Drag & Drop ─────────────────────────────────────────────────────────────
  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) setAttachments(prev => [...prev, ...droppedFiles]);
  };
  const handleDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setDragging(false); };
  const removeAttachment = (index) => setAttachments(prev => prev.filter((_, i) => i !== index));

  // ═══════════════════════════════════════════════════════════════════════════════
  // РЕНДЕР: Экран авторизации
  // ═══════════════════════════════════════════════════════════════════════════════
  if (!token) {
    return (
      <div className="loginContainer">
        <form className="loginForm" onSubmit={handleAuth}>
          <h2>{authMode === "login" ? "Вход" : "Регистрация"}</h2>

          {authError && <div className="authError">{authError}</div>}

          <input
            className="loginInput"
            type="text"
            placeholder="Email"
            value={authEmail}
            onChange={e => setAuthEmail(e.target.value)}
            required
            autoFocus
          />
          <input
            className="loginInput"
            type="password"
            placeholder="Пароль"
            value={authPassword}
            onChange={e => setAuthPassword(e.target.value)}
            required
            minLength={4}
          />
          <button className="loginButton" type="submit" disabled={authLoading}>
            {authLoading ? "Загрузка..." : authMode === "login" ? "Войти" : "Зарегистрироваться"}
          </button>

          <button
            type="button"
            className="authToggle"
            onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(""); }}
          >
            {authMode === "login" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
          </button>
        </form>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // РЕНДЕР: Приложение
  // ═══════════════════════════════════════════════════════════════════════════════
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="userInfo">
          <strong>Почта:</strong>
          <div style={{ marginTop: '4px' }}>{userEmail}</div>
          <button className="logoutButton" onClick={handleLogout}>Выйти</button>
        </div>

        <button className="composeButton" onClick={() => { setCurrentView("compose"); setAttachments([]); }}>Compose</button>
        <button className="navButton" onClick={() => setCurrentView("inbox")}>Inbox</button>
        <button className="navButton" onClick={() => setCurrentView("sent")}>Sent</button>
        {/* <button className="navButton">Trash</button> */}
      </aside>

      <main className="main">
        {(currentView === "inbox" || currentView === "sent") && (
          <>
            <div className="viewHeader">
              <h2>{currentView === "inbox" ? "Inbox" : "Sent"}</h2>
              <input className="search" placeholder="Поиск" />
            </div>

            <div className="emailList">
              {loading ? (
                <p>Loading...</p>
              ) : emails.length === 0 ? (
                <p style={{ padding: '20px', color: '#666' }}>Список пуст</p>
              ) : (
                emails.map((email) => (
                  <div
                    key={email.id}
                    className="emailItem"
                    onClick={() => {
                      if (!email.is_read && currentView === "inbox") markAsRead(email.id);
                      setSelectedEmail({ ...email, is_read: true });
                      setCurrentView("view");
                    }}
                  >
                    <div className="sender" style={{ display: 'flex', alignItems: 'center' }}>
                      <span>{currentView === "inbox" ? `From: ${email.sender_email}` : `To: ${email.recipient_email}`}</span>
                      {!email.is_read && currentView === "inbox" && <span className="unread-indicator"></span>}
                    </div>
                    <div className="subject">
                      {email.subject || "(no subject)"}
                      {email.attachments && email.attachments.length > 0 && (
                        <span className="attachmentBadge">📎 {email.attachments.length}</span>
                      )}
                    </div>
                    <div className="date" style={{ fontSize: '0.8em', color: '#888' }}>
                      {new Date(email.sent_at).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {currentView === "compose" && (
          <form className="composeForm" onSubmit={handleSendEmail}>
            <h2>Новое письмо</h2>
            <input className="composeInput" placeholder="Кому (email)" type="text" required
              value={composeData.recipient_email} onChange={e => setComposeData({ ...composeData, recipient_email: e.target.value })} />
            <input className="composeInput" placeholder="Тема"
              value={composeData.subject} onChange={e => setComposeData({ ...composeData, subject: e.target.value })} />
            <textarea className="composeTextarea" placeholder="Текст письма" rows="10" required
              value={composeData.body} onChange={e => setComposeData({ ...composeData, body: e.target.value })} />

            <div
              className={`dropZone ${dragging ? "dropZoneActive" : ""}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => document.getElementById("fileInput").click()}
            >
              <span className="dropZoneIcon">📎</span>
              <span>{dragging ? "Отпустите файлы сюда" : "Перетащите файлы сюда или нажмите для выбора"}</span>
              <input
                id="fileInput"
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  setAttachments(prev => [...prev, ...Array.from(e.target.files)]);
                  e.target.value = "";
                }}
              />
            </div>

            {attachments.length > 0 && (
              <div className="attachmentList">
                {attachments.map((file, index) => (
                  <div key={index} className="attachmentItem">
                    <span className="attachmentName">📄 {file.name}</span>
                    <span className="attachmentSize">{(file.size / 1024).toFixed(1)} КБ</span>
                    <button type="button" className="attachmentRemove" onClick={() => removeAttachment(index)}>✕</button>
                  </div>
                ))}
              </div>
            )}

            <div className="composeActions">
              <button className="navButton" type="button" onClick={() => setCurrentView("inbox")}>Отмена</button>
              <button className="composeSubmitButton" type="submit" disabled={sending}>
                {sending ? "Отправка..." : "Отправить"}
              </button>
            </div>
          </form>
        )}

        {currentView === "view" && selectedEmail && (
          <div className="emailDetail">
            <div className="emailDetailHeader">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <button className="backButton" onClick={() => setCurrentView(lastListView)}>← Назад</button>
                  <h2>{selectedEmail.subject || "(Без темы)"}</h2>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                  <Histogram email={selectedEmail} />
                  <span style={{ fontSize: '0.8em', color: '#888' }}>Статистика сообщения</span>
                </div>
              </div>
            </div>
            <div className="emailMeta">
              <div className="metaRow"><strong>От:</strong> {selectedEmail.sender_email}</div>
              <div className="metaRow"><strong>Кому:</strong> {selectedEmail.recipient_email}</div>
              <div className="metaRow"><strong>Дата:</strong> {new Date(selectedEmail.sent_at).toLocaleString()}</div>
            </div>
            <div className="emailBody">{selectedEmail.body}</div>

            {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
              <div className="attachmentsSection">
                <h3>Вложения ({selectedEmail.attachments.length})</h3>
                <div className="attachmentDownloadList">
                  {selectedEmail.attachments.map((att) => (
                    <button
                      key={att.id}
                      className="attachmentDownloadItem"
                      onClick={() => downloadAttachment(att.id, att.filename)}
                    >
                      <span className="attachmentDownloadIcon">📎</span>
                      <span>{att.filename}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
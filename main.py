from fastapi import FastAPI, Depends, HTTPException, Form, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session
from jose import JWTError, jwt
import bcrypt
from datetime import datetime, timedelta
import models, database
import os
import uuid


# ─── Настройки безопасности ───────────────────────────────────────────────────
SECRET_KEY = "super-secret-key-change-me"  # В реальном приложении хранить в .env
ALGORITHM = "HS256" # алгоритм шифрования
ACCESS_TOKEN_EXPIRE_MINUTES = 60 # время жизни сессии

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/token")

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ─── Утилиты ─────────────────────────────────────────────────────────────────

def verify_password(plain_password, hashed_password):
    # Проверяем пароль напрямую через bcrypt
    return bcrypt.checkpw(
        plain_password.encode('utf-8'), 
        hashed_password.encode('utf-8')
    )


def get_password_hash(password):
    # Хешируем пароль напрямую через bcrypt
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')


def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None:
        raise credentials_exception
    return user


# ─── Pydantic-схемы ──────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email_id: int
    filename: str
    size: int = 0

class EmailOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sender_email: str
    recipient_email: str
    subject: str | None = None
    body: str | None = None
    sent_at: datetime
    is_read: bool = False
    attachments: list[AttachmentOut] = []


# ─── Приложение ──────────────────────────────────────────────────────────────

app = FastAPI()
api_router = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Для отладки разрешим всё, потом можно сузить
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Создание таблиц при запуске
models.Base.metadata.create_all(bind=database.engine)


# ─── Авторизация ─────────────────────────────────────────────────────────────

@api_router.post("/register")
def register(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    hashed_password = get_password_hash(user.password)
    new_user = models.User(email=user.email, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    return {"message": "User created successfully"}


@api_router.post("/token", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(
        data={"sub": user.email},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": access_token, "token_type": "bearer"}


# ─── Письма ──────────────────────────────────────────────────────────────────

@api_router.get("/emails", response_model=list[EmailOut])
def get_emails(
    folder: str = "inbox",
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(models.Email)
    if folder == "sent":
        query = query.filter(models.Email.sender_email == current_user.email)
    else:
        query = query.filter(models.Email.recipient_email == current_user.email)
    emails = query.order_by(models.Email.sent_at.desc()).all()
    
    # Добавляем размер файлов в ответ
    for email in emails:
        for att in email.attachments:
            if os.path.exists(att.file_path):
                att.size = os.path.getsize(att.file_path)
            else:
                att.size = 0
    return emails


@api_router.post("/emails", response_model=EmailOut)
async def create_email(
    recipient_email: str = Form(...),
    subject: str = Form(""),
    body: str = Form(""),
    files: list[UploadFile] = File(default=[]),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    new_email = models.Email(
        sender_email=current_user.email,
        recipient_email=recipient_email,
        subject=subject or None,
        body=body or None,
        sent_at=datetime.utcnow(),
        is_read=False,
    )
    db.add(new_email)
    db.commit()
    db.refresh(new_email)

    for file in files:
        if not file.filename: continue
        ext = os.path.splitext(file.filename)[1]
        unique_name = f"{uuid.uuid4().hex}{ext}"
        save_path = os.path.join(UPLOAD_DIR, unique_name)
        contents = await file.read()
        with open(save_path, "wb") as f:
            f.write(contents)
        attachment = models.Attachment(email_id=new_email.id, filename=file.filename, file_path=save_path)
        db.add(attachment)

    db.commit()
    db.refresh(new_email)
    return new_email


@api_router.put("/emails/{email_id}/read", response_model=EmailOut)
def mark_email_read(
    email_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    email = db.query(models.Email).filter(
        models.Email.id == email_id,
        models.Email.recipient_email == current_user.email,
    ).first()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    email.is_read = True
    db.commit()
    db.refresh(email)
    return email


@api_router.get("/attachments/{attachment_id}/download")
def download_attachment(
    attachment_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    attachment = db.query(models.Attachment).join(models.Email).filter(
        models.Attachment.id == attachment_id,
        (models.Email.recipient_email == current_user.email)
        | (models.Email.sender_email == current_user.email),
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if not os.path.exists(attachment.file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(
        path=attachment.file_path,
        filename=attachment.filename,
        media_type="application/octet-stream",
    )


app.include_router(api_router)
app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
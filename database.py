from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Формат: postgresql://логин:пароль@хост:порт/название_бд
# Если база в Docker, а код снаружи — используйте localhost и порт, который пробросили (обычно 5432)
SQLALCHEMY_DATABASE_URL = "postgresql://admin:admin123@localhost:5432/maildb"

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

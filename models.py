from sqlalchemy import Column, Integer, String, Text, BigInteger, ForeignKey, TIMESTAMP, Boolean
from sqlalchemy.orm import relationship
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)


class Email(Base):
    __tablename__ = "emails"

    id = Column(BigInteger, primary_key=True, index=True)
    sender_email = Column(String(255), nullable=False)
    recipient_email = Column(String(255), nullable=False, index=True)
    subject = Column(String(500))
    body = Column(Text)
    sent_at = Column(TIMESTAMP, nullable=False)
    is_read = Column(Boolean, default=False)

    attachments = relationship(
        "Attachment",
        back_populates="email",
        cascade="all, delete"
    )


class Attachment(Base):
    __tablename__ = "attachments"

    id = Column(BigInteger, primary_key=True, index=True)
    email_id = Column(BigInteger, ForeignKey("emails.id", ondelete="CASCADE"))
    filename = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)

    email = relationship("Email", back_populates="attachments")

# app/services/email_service.py

import smtplib
import os

from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587

SMTP_USER = os.environ.get("SMTP_EMAIL")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD")


def send_reset_email(to_email: str, reset_link: str):

    if not SMTP_USER or not SMTP_PASSWORD:
        raise Exception("SMTP non configuré")

    subject = "🔐 Réinitialisation du mot de passe"

    html_body = f"""
    <div style="font-family: Arial; padding:20px;">
        <h2>Réinitialisation du mot de passe</h2>

        <p>Cliquez sur le bouton ci-dessous :</p>

        <a href="{reset_link}"
           style="
                display:inline-block;
                padding:12px 20px;
                background:#00d4ff;
                color:white;
                text-decoration:none;
                border-radius:8px;
                font-weight:bold;
           ">
           Réinitialiser le mot de passe
        </a>

        <p style="margin-top:20px;">
            Ce lien expire dans <strong>5 minutes</strong>.
        </p>

        <p>
            Si vous n'avez pas demandé cette action,
            ignorez simplement cet email.
        </p>
    </div>
    """

    msg = MIMEMultipart("alternative")

    msg["Subject"] = subject
    msg["From"] = SMTP_USER
    msg["To"] = to_email

    msg.attach(MIMEText(html_body, "html"))

    try:

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:

            server.ehlo()

            server.starttls()

            server.login(SMTP_USER, SMTP_PASSWORD)

            server.sendmail(
                SMTP_USER,
                to_email,
                msg.as_string()
            )

        print(f"[EMAIL SENT] -> {to_email}")

        return True

    except Exception as e:

        print("[EMAIL ERROR]", str(e))

        return False
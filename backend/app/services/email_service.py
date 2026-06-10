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


def send_reset_email(to_email: str, otp_code: str):

    if not SMTP_USER or not SMTP_PASSWORD:
        raise Exception("SMTP non configuré")

    subject = "Reset password verification code"

    html_body = f"""
    <div style="font-family: Arial; padding:20px;">
        <h2>Password reset verification</h2>

        <p>Use the one-time code below to verify your password reset request:</p>

        <div style="
            display:inline-block;
            padding:14px 20px;
            background:#0f172a;
            color:#00d4ff;
            border:1px solid #1e293b;
            border-radius:10px;
            font-size:28px;
            letter-spacing:6px;
            font-weight:bold;
        ">
            {otp_code}
        </div>

        <p style="margin-top:20px;">
            This code expires in <strong>5 minutes</strong>.
        </p>

        <p>
            If you did not request this action, you can ignore this email.
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

import io


def extract_text_from_file(filename: str, content_type: str | None, content: bytes) -> tuple[str, str]:
    lower_name = filename.lower()
    clean_type = (content_type or "").lower()

    if lower_name.endswith((".txt", ".md", ".csv")) or clean_type.startswith("text/"):
        return content.decode("utf-8", errors="ignore").strip(), "Text file parsed."

    if lower_name.endswith(".pdf") or "pdf" in clean_type:
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(content))
            pages = [page.extract_text() or "" for page in reader.pages[:8]]
            text = "\n".join(pages).strip()
            return text, "PDF parsed locally." if text else "PDF had no selectable text. Scanned PDFs need OCR."
        except Exception as exc:
            return "", f"PDF extraction failed: {exc}"

    if lower_name.endswith(".docx") or "wordprocessingml" in clean_type:
        try:
            from docx import Document

            document = Document(io.BytesIO(content))
            text = "\n".join(paragraph.text for paragraph in document.paragraphs).strip()
            return text, "DOCX parsed locally." if text else "DOCX did not contain readable text."
        except Exception as exc:
            return "", f"DOCX extraction failed: {exc}"

    if lower_name.endswith((".jpg", ".jpeg", ".png", ".webp")) or clean_type.startswith("image/"):
        return "", "Image uploaded. OCR for scanned images needs Sarvam Document Intelligence; paste text for now."

    return "", "Unsupported file type. Use TXT, PDF, DOCX, or paste resume text."


class LocalDocumentParserService:
    def extract_text(self, filename: str, content_type: str | None, content: bytes) -> tuple[str, str]:
        return extract_text_from_file(filename, content_type, content)

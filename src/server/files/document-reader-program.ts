/** Runs on the authorized Computer, never in the web process. Inputs are argv, not shell interpolation. */
export const DOCUMENT_READER_PROGRAM = String.raw`
import json, os, shutil, subprocess, sys

def main():
    import pymupdf
    source, output, page_arg, mode = sys.argv[1:5]
    page_number = int(page_arg)
    if mode not in ('text', 'render', 'tables', 'ocr', 'metadata'):
        raise ValueError('Unsupported reading mode')
    if os.path.getsize(source) > 100 * 1024 * 1024:
        raise ValueError('Document exceeds reader byte limit')
    with pymupdf.open(source) as doc:
        if doc.needs_pass:
            raise ValueError('Document requires a password')
        result = {'pageCount': len(doc), 'page': page_number, 'mode': mode}
        if mode == 'metadata':
            print(json.dumps(result))
            return
        if page_number < 1 or page_number > len(doc):
            raise ValueError('Page is outside the document')
        page = doc[page_number - 1]
        result['width'] = page.rect.width
        result['height'] = page.rect.height
        if mode == 'text':
            text = page.get_text(sort=True)
            result['text'] = text[:60000]
            result['truncated'] = len(text) > 60000
            result['needsVisualInspection'] = not text.strip()
        elif mode == 'tables':
            tables = page.find_tables().tables
            result['tables'] = []
            remaining = 60000
            truncated = False
            for table in tables[:20]:
                rows = table.extract()
                encoded = json.dumps(rows)
                if len(encoded) > remaining:
                    truncated = True
                    break
                remaining -= len(encoded)
                result['tables'].append({'bbox': list(table.bbox), 'rows': rows})
            result['truncated'] = truncated or len(tables) > 20
            result['requiresVerification'] = True
        else:
            if mode == 'ocr' and not shutil.which('tesseract'):
                raise RuntimeError('OCR_UNAVAILABLE')
            longest = max(page.rect.width, page.rect.height)
            if longest <= 0:
                raise ValueError('Invalid page dimensions')
            scale = min(2, 2048 / longest)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
            pix.save(output)
            result['imagePath'] = output
            result['imageWidth'] = pix.width
            result['imageHeight'] = pix.height
            if mode == 'ocr':
                ocr = subprocess.run(['tesseract', output, 'stdout'], capture_output=True, timeout=60, check=True)
                text = ocr.stdout.decode('utf-8', errors='replace')
                result['text'] = text[:60000]
                result['truncated'] = len(text) > 60000
                result['requiresVerification'] = True
        print(json.dumps(result))

try:
    main()
except Exception as error:
    print(json.dumps({'error': type(error).__name__, 'message': str(error)[:500]}))
    sys.exit(1)
`

import "dotenv/config";
import express from "express";
import cors from "cors";
import https from "https";
import fs from "fs";
import path from "path";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "url";
import { dirname } from "path";
import forge from "node-forge";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3001;

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Serve static files from client build
const clientBuildPath = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientBuildPath));

// Initialize Anthropic client
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Routes
app.get("/", (req, res) => {
  res.json({
    message: "Inkling OCR Server",
    version: "2.0.0",
    status: "running",
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", engine: "claude-vision" });
});

app.post("/api/ocr", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image provided" });
    }

    const base64Image = req.file.buffer.toString("base64");
    const mediaType = req.file.mimetype;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Image,
              },
            },
            {
              type: "text",
              text: "Transcribe all handwritten or printed text in this image exactly as written. Output only the transcribed text with no additional commentary, labels, or explanation.",
            },
          ],
        },
      ],
    });

    const text = message.content[0].text.trim();

    res.json({
      success: true,
      text,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("OCR Error:", error);
    res
      .status(500)
      .json({ error: "Failed to process image", details: error.message });
  }
});

// Start server
const startServer = async () => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("ERROR: ANTHROPIC_API_KEY is not set in your .env file");
      process.exit(1);
    }

    const port = process.env.PORT || PORT;
    const isProduction = process.env.NODE_ENV === "production";

    if (isProduction) {
      // On hosted platforms (Railway, Render, etc.) HTTPS is handled externally
      // Must bind to 0.0.0.0 so Railway can route traffic to the container
      app.listen(port, "0.0.0.0", () => {
        console.log(`✓ Inkling server running on port ${port}`);
        console.log(`✓ OCR engine: Claude Vision`);
      });
    } else {
      // Local dev: use self-signed HTTPS so camera works over localhost
      const keyPath = `${__dirname}/key.pem`;
      const certPath = `${__dirname}/cert.pem`;

      let key, cert;

      if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
        console.log("Generating self-signed HTTPS certificates...");

        const pem = forge.pki.rsa.generateKeyPair(2048);
        const cert_obj = forge.pki.createCertificate();

        cert_obj.publicKey = pem.publicKey;
        cert_obj.serialNumber = "01";
        cert_obj.validity.notBefore = new Date();
        cert_obj.validity.notAfter = new Date();
        cert_obj.validity.notAfter.setFullYear(
          cert_obj.validity.notAfter.getFullYear() + 1,
        );

        cert_obj.setSubject([
          { name: "commonName", value: "127.0.0.1" },
          { name: "organizationName", value: "Inkling" },
        ]);

        cert_obj.setIssuer([
          { name: "commonName", value: "127.0.0.1" },
          { name: "organizationName", value: "Inkling" },
        ]);

        cert_obj.setExtensions([
          { name: "basicConstraints", cA: true },
          {
            name: "keyUsage",
            keyCertSign: true,
            digitalSignature: true,
            nonRepudiation: true,
            keyEncipherment: true,
            dataEncipherment: true,
          },
          {
            name: "extKeyUsage",
            serverAuth: true,
            clientAuth: true,
            codeSigning: true,
            emailProtection: true,
            timeStamping: true,
          },
          {
            name: "subjectAltName",
            altNames: [
              { type: 7, ip: "127.0.0.1" },
              { type: 2, value: "localhost" },
            ],
          },
        ]);

        cert_obj.sign(pem.privateKey, forge.md.sha256.create());

        key = forge.pki.privateKeyToPem(pem.privateKey);
        cert = forge.pki.certificateToPem(cert_obj);

        fs.writeFileSync(keyPath, key);
        fs.writeFileSync(certPath, cert);
      } else {
        key = fs.readFileSync(keyPath, "utf8");
        cert = fs.readFileSync(certPath, "utf8");
      }

      const httpsServer = https.createServer({ key, cert }, app);

      httpsServer.listen(port, "127.0.0.1", () => {
        console.log(`✓ Inkling HTTPS server running at https://127.0.0.1:${port}`);
        console.log(`✓ Health check: https://127.0.0.1:${port}/health`);
        console.log(`✓ OCR engine: Claude Vision`);
      });
    }
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

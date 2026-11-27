import ArgumentParser
import Foundation
import Hummingbird
import NIOCore
import NIOPosix
import ParakeetCore

@main
struct ParakeetCLI: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "parakeet-cli",
        abstract: "Parakeet TDT Speech-to-Text Server",
        version: "1.0.0"
    )
    
    @Option(name: .long, help: "Path to the CoreML model directory")
    var modelPath: String
    
    @Option(name: .long, help: "Model version (v2 or v3)")
    var modelVersion: String = "v2"
    
    @Option(name: .long, help: "Host to bind the server to")
    var host: String = "127.0.0.1"
    
    @Option(name: .long, help: "Port to bind the server to")
    var port: Int = 50080

    @Option(name: .long, help: "Transcribe one audio file and exit without starting an HTTP server")
    var audioPath: String?
    
    @Flag(name: .long, help: "Enable verbose logging")
    var verbose: Bool = false
    
    func run() async throws {
        print("[Parakeet] Starting Parakeet TDT Server...")
        print("[Parakeet] Model path: \(modelPath)")
        print("[Parakeet] Model version: \(modelVersion)")
        print("[Parakeet] Host: \(host)")
        print("[Parakeet] Port: \(port)")
        print("[Parakeet] Verbose: \(verbose)")
        
        // Validate model path
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: modelPath) else {
            print("[Parakeet] Error: Model path does not exist: \(modelPath)")
            throw ExitCode.failure
        }
        
        // Initialize the Parakeet engine
        print("[Parakeet] Loading CoreML models...")
        let engine = try await ParakeetEngine(
            modelPath: modelPath,
            modelVersion: modelVersion == "v3" ? .v3 : .v2,
            verbose: verbose
        )
        print("[Parakeet] Models loaded successfully")

        if let audioPath {
            guard fileManager.fileExists(atPath: audioPath) else {
                print("[Parakeet] Error: Audio path does not exist")
                throw ExitCode.failure
            }
            let result = try await engine.transcribe(audioPath: audioPath)
            let response: [String: Any] = [
                "text": result.text,
                "language": result.language ?? "en",
                "duration": result.audioDuration ?? 0
            ]
            let jsonData = try JSONSerialization.data(withJSONObject: response, options: [])
            guard let json = String(data: jsonData, encoding: .utf8) else {
                throw ExitCode.failure
            }
            print("OVERLAY_TRANSCRIPTION_RESULT:\(json)")
            return
        }
        
        // Create and configure the HTTP server
        let router = Router()
        
        // Health check endpoint
        router.get("/health") { _, _ in
            return Response(
                status: .ok,
                headers: [.contentType: "application/json"],
                body: .init(byteBuffer: ByteBuffer(string: #"{"status":"ok","model":"\#(modelVersion)"}"#))
            )
        }
        
        // Root endpoint (for readiness polling)
        router.get("/") { _, _ in
            return Response(
                status: .ok,
                headers: [.contentType: "application/json"],
                body: .init(byteBuffer: ByteBuffer(string: #"{"status":"ready","version":"1.0.0"}"#))
            )
        }
        
        // OpenAI-compatible transcription endpoint
        router.post("/v1/audio/transcriptions") { request, context in
            return try await handleTranscription(request: request, context: context, engine: engine, verbose: verbose)
        }
        
        // Create the application
        let app = Application(
            router: router,
            configuration: .init(
                address: .hostname(host, port: port),
                serverName: "ParakeetServer"
            )
        )
        
        print("[Parakeet] Server starting on http://\(host):\(port)")
        print("[Parakeet] Endpoints:")
        print("[Parakeet]   GET  /health")
        print("[Parakeet]   GET  /")
        print("[Parakeet]   POST /v1/audio/transcriptions")
        
        try await app.runService()
    }
}

// MARK: - Transcription Handler

func handleTranscription(
    request: Request,
    context: some RequestContext,
    engine: ParakeetEngine,
    verbose: Bool
) async throws -> Response {
    let startTime = Date()
    
    if verbose {
        print("[Parakeet] Received transcription request")
    }
    
    // Parse multipart form data
    guard let contentType = request.headers[.contentType],
          contentType.contains("multipart/form-data") else {
        return errorResponse(status: .badRequest, message: "Content-Type must be multipart/form-data")
    }
    
    // Extract boundary from content type
    guard let boundaryRange = contentType.range(of: "boundary="),
          let boundary = contentType[boundaryRange.upperBound...].split(separator: ";").first else {
        return errorResponse(status: .badRequest, message: "Missing boundary in Content-Type")
    }
    
    // Collect request body
    var bodyData = Data()
    for try await buffer in request.body {
        bodyData.append(contentsOf: buffer.readableBytesView)
    }
    
    // Parse multipart data to extract audio file
    guard let audioData = parseMultipartFormData(data: bodyData, boundary: String(boundary), fieldName: "file") else {
        return errorResponse(status: .badRequest, message: "Missing 'file' field in multipart form data")
    }
    
    if verbose {
        print("[Parakeet] Audio data size: \(audioData.count) bytes")
    }
    
    // Save audio to temporary file
    let tempDir = FileManager.default.temporaryDirectory
    let tempFile = tempDir.appendingPathComponent("parakeet_audio_\(UUID().uuidString).wav")
    
    do {
        try audioData.write(to: tempFile)
    } catch {
        return errorResponse(status: .internalServerError, message: "Failed to save audio file: \(error.localizedDescription)")
    }
    
    defer {
        try? FileManager.default.removeItem(at: tempFile)
    }
    
    // Perform transcription
    do {
        let result = try await engine.transcribe(audioPath: tempFile.path)
        let duration = Date().timeIntervalSince(startTime)
        
        if verbose {
            print("[Parakeet] Transcription completed in \(String(format: "%.2f", duration))s")
            print("[Parakeet] Result: \(result.text)")
        }
        
        // Build response
        let response: [String: Any] = [
            "text": result.text,
            "language": result.language ?? "en",
            "duration": result.audioDuration ?? duration
        ]
        
        let jsonData = try JSONSerialization.data(withJSONObject: response, options: [])
        let jsonString = String(data: jsonData, encoding: .utf8) ?? "{}"
        
        return Response(
            status: .ok,
            headers: [.contentType: "application/json"],
            body: .init(byteBuffer: ByteBuffer(string: jsonString))
        )
    } catch {
        print("[Parakeet] Transcription error: \(error)")
        return errorResponse(status: .internalServerError, message: "Transcription failed: \(error.localizedDescription)")
    }
}

// MARK: - Helpers

func errorResponse(status: HTTPResponse.Status, message: String) -> Response {
    let json = #"{"error":"\#(message)"}"#
    return Response(
        status: status,
        headers: [.contentType: "application/json"],
        body: .init(byteBuffer: ByteBuffer(string: json))
    )
}

func parseMultipartFormData(data: Data, boundary: String, fieldName: String) -> Data? {
    let boundaryData = "--\(boundary)".data(using: .utf8)!
    let endBoundaryData = "--\(boundary)--".data(using: .utf8)!
    
    // Split by boundary
    var parts: [Data] = []
    var currentIndex = data.startIndex
    
    while currentIndex < data.endIndex {
        guard let boundaryRange = data.range(of: boundaryData, options: [], in: currentIndex..<data.endIndex) else {
            break
        }
        
        if currentIndex != boundaryRange.lowerBound {
            let partData = data[currentIndex..<boundaryRange.lowerBound]
            if !partData.isEmpty {
                parts.append(Data(partData))
            }
        }
        
        currentIndex = boundaryRange.upperBound
    }
    
    // Parse each part
    for part in parts {
        // Skip if it's the end boundary
        if part.starts(with: endBoundaryData) {
            continue
        }
        
        // Find the header/body separator (double CRLF)
        guard let headerEndRange = part.range(of: "\r\n\r\n".data(using: .utf8)!) else {
            continue
        }
        
        let headerData = part[part.startIndex..<headerEndRange.lowerBound]
        guard let headerString = String(data: headerData, encoding: .utf8) else {
            continue
        }
        
        // Check if this is the field we're looking for
        if headerString.contains("name=\"\(fieldName)\"") || headerString.contains("name=\"\(fieldName)\"") {
            // Extract body (skip trailing CRLF if present)
            var bodyData = Data(part[headerEndRange.upperBound...])
            
            // Remove trailing CRLF
            if bodyData.count >= 2 {
                let suffix = bodyData.suffix(2)
                if suffix == "\r\n".data(using: .utf8)! {
                    bodyData = bodyData.dropLast(2)
                }
            }
            
            return bodyData
        }
    }
    
    return nil
}

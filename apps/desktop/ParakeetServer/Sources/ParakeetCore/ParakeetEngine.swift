import Foundation
import FluidAudio

// MARK: - Types

public enum ParakeetModelVersion {
    case v2
    case v3
    
    var asrVersion: AsrModelVersion {
        switch self {
        case .v2: return .v2
        case .v3: return .v3
        }
    }
}

public struct TranscriptionResult {
    public let text: String
    public let language: String?
    public let audioDuration: Double?
    public let confidence: Float?
    
    public init(text: String, language: String? = nil, audioDuration: Double? = nil, confidence: Float? = nil) {
        self.text = text
        self.language = language
        self.audioDuration = audioDuration
        self.confidence = confidence
    }
}

// MARK: - Errors

public enum ParakeetError: Error, LocalizedError {
    case modelLoadFailed(String)
    case audioProcessingFailed(String)
    case transcriptionFailed(String)
    
    public var errorDescription: String? {
        switch self {
        case .modelLoadFailed(let msg): return "Model load failed: \(msg)"
        case .audioProcessingFailed(let msg): return "Audio processing failed: \(msg)"
        case .transcriptionFailed(let msg): return "Transcription failed: \(msg)"
        }
    }
}

// MARK: - Parakeet Engine

public actor ParakeetEngine {
    private let modelPath: String
    private let modelVersion: ParakeetModelVersion
    private let verbose: Bool
    
    private var asrManager: AsrManager?
    private var audioConverter: AudioConverter?
    
    public init(modelPath: String, modelVersion: ParakeetModelVersion, verbose: Bool = false) async throws {
        self.modelPath = modelPath
        self.modelVersion = modelVersion
        self.verbose = verbose
        
        try await loadModels()
    }
    
    // MARK: - Model Loading
    
    private func loadModels() async throws {
        if verbose {
            print("[ParakeetEngine] Loading models from: \(modelPath)")
            print("[ParakeetEngine] Model version: \(modelVersion)")
        }
        
        // Load models from local path using FluidAudio
        let modelURL = URL(fileURLWithPath: modelPath)
        let models = try await AsrModels.load(from: modelURL, version: modelVersion.asrVersion)
        
        if verbose {
            print("[ParakeetEngine] Models loaded successfully")
        }
        
        // Initialize ASR manager
        asrManager = AsrManager(config: .default)
        try await asrManager?.initialize(models: models)
        
        // Initialize audio converter
        audioConverter = AudioConverter()
        
        if verbose {
            print("[ParakeetEngine] ASR manager initialized")
        }
    }
    
    // MARK: - Transcription
    
    public func transcribe(audioPath: String) async throws -> TranscriptionResult {
        guard let asrManager = asrManager, let audioConverter = audioConverter else {
            throw ParakeetError.modelLoadFailed("ASR manager not initialized")
        }
        
        let startTime = Date()
        
        if verbose {
            print("[ParakeetEngine] Transcribing: \(audioPath)")
        }
        
        // Convert audio to 16kHz mono Float32 samples using FluidAudio's converter
        let samples: [Float]
        do {
            samples = try audioConverter.resampleAudioFile(path: audioPath)
        } catch {
            throw ParakeetError.audioProcessingFailed("Failed to convert audio: \(error.localizedDescription)")
        }
        
        let audioDuration = Double(samples.count) / 16000.0
        
        if verbose {
            print("[ParakeetEngine] Audio duration: \(String(format: "%.2f", audioDuration))s")
            print("[ParakeetEngine] Sample count: \(samples.count)")
        }
        
        // Transcribe using FluidAudio's ASR manager
        do {
            let result = try await asrManager.transcribe(samples, source: .system)
            
            let processingTime = Date().timeIntervalSince(startTime)
            
            if verbose {
                print("[ParakeetEngine] Transcription completed in \(String(format: "%.2f", processingTime))s")
                print("[ParakeetEngine] Result: \(result.text)")
                print("[ParakeetEngine] Confidence: \(result.confidence)")
            }
            
            return TranscriptionResult(
                text: result.text,
                language: modelVersion == .v2 ? "en" : nil,
                audioDuration: audioDuration,
                confidence: result.confidence
            )
        } catch {
            throw ParakeetError.transcriptionFailed("ASR failed: \(error.localizedDescription)")
        }
    }
}

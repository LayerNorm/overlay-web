// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ParakeetServer",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "parakeet-cli", targets: ["parakeet-cli"])
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-argument-parser.git", from: "1.3.0"),
        .package(url: "https://github.com/hummingbird-project/hummingbird.git", from: "2.0.0"),
        .package(url: "https://github.com/apple/swift-nio.git", from: "2.65.0"),
        .package(url: "https://github.com/FluidInference/FluidAudio.git", branch: "main")
    ],
    targets: [
        .executableTarget(
            name: "parakeet-cli",
            dependencies: [
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
                .product(name: "Hummingbird", package: "hummingbird"),
                .product(name: "NIOCore", package: "swift-nio"),
                .product(name: "NIOPosix", package: "swift-nio"),
                .product(name: "FluidAudio", package: "FluidAudio"),
                "ParakeetCore"
            ]
        ),
        .target(
            name: "ParakeetCore",
            dependencies: [
                .product(name: "FluidAudio", package: "FluidAudio")
            ]
        )
    ]
)

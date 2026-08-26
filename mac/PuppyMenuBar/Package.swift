// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "PuppyMenuBar",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "PuppyMenuBar", targets: ["PuppyMenuBar"])
    ],
    targets: [
        .executableTarget(name: "PuppyMenuBar"),
        .testTarget(name: "PuppyMenuBarTests", dependencies: ["PuppyMenuBar"])
    ]
)

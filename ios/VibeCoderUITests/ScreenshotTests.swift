import XCTest

@MainActor
class ScreenshotTests: XCTestCase {
    let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
        setupSnapshot(app)
        app.launch()
    }

    func testScreenshots() {
        sleep(3)
        // Default tab is Create (index 1)
        snapshot("01_Create")

        app.tabBars.buttons["Projects"].tap()
        sleep(1)
        snapshot("02_Projects")

        app.tabBars.buttons["Account"].tap()
        sleep(1)
        snapshot("03_Account")

        app.tabBars.buttons["Create"].tap()
        sleep(1)
        snapshot("04_CreateMain")
    }
}

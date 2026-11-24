// Replacement for LG Home's main view: a black screen that opens io.github.file48.homescreen whenever Home is shown.
// LG's Home program keeps running and handling the remote; only its main view is swapped (bind mount, RAM only).
// Bind-mounted over qml/UserInterfaceLayer/Containers/MainView_M.qml by home-takeover.sh, then LG Home is
// stopped and restores itself from its CRIU snapshot, reading this file from disk.
// The compatibility stand-ins and lifecycle handling are adapted from webos-home by Mr-Neutr0n
// (https://github.com/Mr-Neutr0n/webos-home, MIT licence, Copyright (c) 2026 webOS Home contributors).
import QtQuick 2.12

FocusScope {
    id: root

    readonly property string launcherId: "io.github.file48.homescreen"

    property var main
    property alias shelfList: shelfListCompat
    property alias shelfListContainer: shelfListContainerCompat
    property alias topArea: topAreaCompat
    property alias editMenu: editMenuCompat
    property alias recents: recentsCompat
    property alias settingPopup: settingPopupCompat
    property alias appListArea: appListCompat
    property alias editMenuLoaderStatus: editMenuLoader.status
    property bool showFooterButton: false
    property bool needResetModel: false
    property var styleSheet: styleSheetCompat
    property int topAreaYPos: 0
    property int topAreaHeight: 0
    property bool wasShown: false
    property bool launching: false
    // members LG's controller reads from its main view on this firmware (harmless defaults)
    property bool hasFocus: false
    property bool keepImageAlive: false
    property bool imageReady: true
    property bool isRemoconEditMode: false
    property bool isAppViewCondition: false
    property var mainViewModel: null
    property var homeWallpaperPopup: null
    property var qCardListArea: null
    property var homeLayoutLoaderItem: null
    property var homeOverlayLoaderItem: null
    property var entry: null
    property int index: 0

    readonly property bool homeActive: root.visible && win() !== null && win().active
                                       && ui() !== null && ui().homeShown && !ui().isHiddenMode

    signal hideTransitionFinished()
    signal hideTransitonFinished()
    signal setShelfListModel(var viewState)
    signal resetShelves()
    signal clearShelfModel()
    signal allShelfListUpdate()

    focus: true
    anchors.fill: parent

    // LG's controller objects, looked up safely (null if this firmware names them differently)
    function ui() { try { return uiController; } catch (e) { return null; } }
    function win() { try { return rootWindow; } catch (e) { return null; } }
    function lgInterfaces() { try { return interfaces; } catch (e) { return null; } }
    function say(text) { console.log("[homescreen] " + text); }

    // ---- compatibility stand-ins for what LG's controller reads from its main view
    QtObject { id: styleSheetCompat; function getRValue(value) { return value; } }
    Item { id: shelfListContainerCompat; state: "native"; property bool transitionShelfListRunning: false; property bool processingWheel: false }
    Item { id: shelfListCompat; property int currentIndex: 0; property int count: 0; property var model: ({ count: 0 }) }
    Item { id: topAreaCompat; property int currentIndex: 0; property int count: 0; property var model: ({ count: 0 }); property bool topShelfLoaded: true }
    Item { id: recentsCompat; visible: false }
    Item { id: appListCompat; visible: false }
    Item { id: settingPopupCompat; visible: false }
    Item {
        id: editMenuCompat
        property var shelfListEditPage: editShelfCompat
        function createSettingPopup() {}
        function closeSettingPopup() {}
        function runVoiceEdit() {}
    }
    Item { id: editShelfCompat; function createSettingPopup() {} }
    Loader {
        id: editMenuLoader
        active: false
        visible: false
        sourceComponent: Component { Item {} }
    }

    Rectangle { anchors.fill: parent; color: "black" }

    // ---- open our launcher
    function openLauncher(why) {
        if (launching) return;
        var app = (ui() && ui().interfaces) ? ui().interfaces.application : null;
        if (!app && lgInterfaces()) app = lgInterfaces().application;
        if (!app || !app.launchApp) { say("no launchApp available (" + why + ")"); retry.restart(); return; }
        launching = true;
        settle.restart();
        say("opening launcher (" + why + ")");
        try {
            app.launchApp(launcherId, "", {}, "", function (response) {
                launching = false;
                say("launch reply " + JSON.stringify(response));
            });
        } catch (error) {
            launching = false;
            say("launch error " + error);
            retry.restart();
        }
    }
    Timer { id: settle; interval: 2000; onTriggered: root.launching = false }
    Timer { id: retry; interval: 1500; onTriggered: if (root.homeActive) root.openLauncher("retry") }

    onHomeActiveChanged: if (homeActive) openLauncher("home shown")

    // ---- mirror the stock view's lifecycle for LG's controller, without building any shelves
    state: ui() ? ui().state : ""

    onStateChanged: {
        if (!ui()) return;
        var uiController = ui();
        if (state === "hidden") {
            if (!root.wasShown) return;
            uiController.isRecentMode = false;
            uiController.introRan = false;
            uiController.mainTransitionFinished = false;
            Qt.callLater(function () {
                if (root.state !== "hidden") return;
                root.wasShown = false;
                root.hideTransitionFinished();
                root.hideTransitonFinished();
                if (uiController.hideWindow) uiController.hideWindow();
            });
        } else if (state === "main" || state === "half" || state === "sub") {
            root.wasShown = true;
            uiController.isFullHome = state === "main";
            uiController.introRan = true;
            uiController.mainTransitionFinished = true;
            uiController.isRecentMode = false;
            if (homeActive) openLauncher("state " + state);
        } else if (state === "editMenu") {
            Qt.callLater(function () { uiController.goToState("main"); });
        }
    }

    function initialize() {
        var uiController = ui();
        if (uiController) {
            if (uiController.interfaces && uiController.interfaces.initApp && uiController.interfaces.initApp.closeAnimation)
                uiController.interfaces.initApp.closeAnimation();
            uiController.isFullHome = true;
            uiController.mainTransitionFinished = state === "main";
            uiController.mainRibbonReady = true;
            uiController.introRan = state === "main";
        }
        if (homeActive) openLauncher("initialize");
    }
    function goToTop() {}
    function startEdit(startPoint) { var u = ui(); if (u && u.state === "editMenu") u.goToState("main"); }
    function showOptionMenu() {}
    function closeSettingPopup() {}
    function reset() {}
    function setModel() {}
    function resetShelfListContainerState() {}

    Component.onCompleted: {
        say("replacement main view loaded");
        if (homeActive) openLauncher("loaded");
    }
}

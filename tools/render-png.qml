// Rasterizes SVG files to PNG with Qt's SVG renderer, keeping alpha.
// Usage: qml render-png.qml -- <size> <out dir> <file.svg>...
import QtQuick

Item {
    id: root
    width: 512; height: 512
    property var args: Qt.application.arguments.slice(Qt.application.arguments.indexOf("--") + 1)
    property int size: parseInt(args[0])
    property string outDir: args[1]
    property var files: args.slice(2)
    property int index: 0

    Image {
        id: img
        width: root.size; height: root.size
        sourceSize.width: root.size; sourceSize.height: root.size
        smooth: true
        onStatusChanged: if (status === Image.Ready) grab.start()
    }
    Timer {
        id: grab
        interval: 30
        onTriggered: img.grabToImage(function (r) {
            const f = root.files[root.index];
            const name = f.substring(f.lastIndexOf("/") + 1).replace(/\.svg$/, ".png");
            r.saveToFile(root.outDir + "/" + name);
            root.next();
        }, Qt.size(root.size, root.size))
    }
    function next() {
        index++;
        if (index >= files.length) { Qt.quit(); return; }
        img.source = "file://" + files[index];
    }
    Component.onCompleted: img.source = "file://" + files[0]
}

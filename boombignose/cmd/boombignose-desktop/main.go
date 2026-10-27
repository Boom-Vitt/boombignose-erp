//go:build desktop

// Command boombignose-desktop is the BoomBigNose window. It refuses cloud
// credentials, then opens a Wails webview and navigates that window to the
// local ERP. It does not proxy the page and it does not call a cloud model.
package main

import (
	"context"
	"embed"
	"fmt"
	"os"

	"github.com/Boom-Vitt/boombignose-erp/boombignose/internal/policy"
	"github.com/Boom-Vitt/boombignose-erp/boombignose/internal/shell"
	"github.com/Boom-Vitt/boombignose-erp/boombignose/nav"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "boombignose: %s\n", err.Error())
		os.Exit(1)
	}
}

func run() error {
	if err := policy.CheckEnv(os.Getenv); err != nil {
		return err
	}
	target, err := shell.ERPURL(os.Getenv("BOOMBIGNOSE_ERP_URL"))
	if err != nil {
		return fmt.Errorf("BOOMBIGNOSE_ERP_URL: %w", err)
	}
	script, err := nav.Script(target)
	if err != nil {
		return err
	}
	return wails.Run(&options.App{
		Title:            "BoomBigNose",
		Width:            1280,
		Height:           800,
		BackgroundColour: options.NewRGB(0x0B, 0x1E, 0x3A),
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnDomReady: func(ctx context.Context) {
			runtime.WindowExecJS(ctx, script)
		},
	})
}

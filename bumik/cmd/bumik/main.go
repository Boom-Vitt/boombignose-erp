// Command bumik is the local harness for Bumik Node ERP harness AI.
// It prints no secrets. It does not open a window and it does not call the network.
package main

import (
	"fmt"
	"os"

	"github.com/Boom-Vitt/boombignose-erp/bumik/internal/cutover"
	"github.com/Boom-Vitt/boombignose-erp/bumik/internal/policy"
	"github.com/Boom-Vitt/boombignose-erp/bumik/internal/shell"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "bumik: %s\n", err.Error())
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("usage: bumik check | bumik cutover")
	}
	switch args[0] {
	case "check":
		if err := policy.CheckEnv(os.Getenv); err != nil {
			return err
		}
		url, err := shell.ERPURL(os.Getenv("BUMIK_ERP_URL"))
		if err != nil {
			return fmt.Errorf("BUMIK_ERP_URL: %w", err)
		}
		fmt.Printf("bumik local-ok erp=%s\n", url)
		return nil
	case "cutover":
		if err := policy.CheckEnv(os.Getenv); err != nil {
			return err
		}
		fmt.Print(cutover.Plan())
		return nil
	default:
		return fmt.Errorf("usage: bumik check | bumik cutover")
	}
}

// Command boombignose is the local harness for BoomBigNose.
// It prints no secrets. It does not open a window and it does not call the network.
package main

import (
	"fmt"
	"os"

	"github.com/Boom-Vitt/boombignose-erp/boombignose/internal/cutover"
	"github.com/Boom-Vitt/boombignose-erp/boombignose/internal/policy"
	"github.com/Boom-Vitt/boombignose-erp/boombignose/internal/shell"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "boombignose: %s\n", err.Error())
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("usage: boombignose check | boombignose cutover")
	}
	switch args[0] {
	case "check":
		if err := policy.CheckEnv(os.Getenv); err != nil {
			return err
		}
		url, err := shell.ERPURL(os.Getenv("BOOMBIGNOSE_ERP_URL"))
		if err != nil {
			return fmt.Errorf("BOOMBIGNOSE_ERP_URL: %w", err)
		}
		fmt.Printf("boombignose local-ok erp=%s\n", url)
		return nil
	case "cutover":
		if err := policy.CheckEnv(os.Getenv); err != nil {
			return err
		}
		fmt.Print(cutover.Plan())
		return nil
	default:
		return fmt.Errorf("usage: boombignose check | boombignose cutover")
	}
}

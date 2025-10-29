import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import * as util from 'util';

const execPromise = util.promisify(exec);

export class BuildGraphCommandProvider {
    private terminal: vscode.Terminal | undefined;

    // Runs the BuildGraph script with -ListOnly and no target.
    public async runListOnly(editor: vscode.TextEditor) {
        const command = await this.buildUatCommand(editor.document, true, undefined, undefined);
        if (command) {
            this.runInTerminal(`& ${command}`);
        }
    }

    // Displays a Quick Pick menu to select a target, prompts for optional arguments, and then runs the target.
    public async runTarget(editor: vscode.TextEditor) {
        const document = editor.document;
        const position = editor.selection.active;
        const line = document.lineAt(position.line);

        // Build Quick Pick Options
        const quickPickItems: (vscode.QuickPickItem & { target?: string | null })[] = [];

        const staticTargetName = this.getTargetNameAtLine(line, true);
        if (staticTargetName) {
            quickPickItems.push({
                label: `Selected target: ${staticTargetName}`,
                description: "Run the statically-named target from the current line",
                target: staticTargetName
            });
        }

        quickPickItems.push({
            label: "Specify target...",
            description: "Manually type in a target name",
            target: null
        });

        quickPickItems.push({
            label: "Select target from compiled buildgraph...",
            description: "Runs -ListOnly to find all available targets",
            target: null
        });

        // Show Quick Pick
        const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
            title: "Run BuildGraph Target",
            placeHolder: "Choose how to select a target"
        });

        if (!selectedItem) {
            return;
        }

        // Handle Selection
        let targetToRun: string | undefined;
        let parsedOptions: string[] = [];
        let extraArgs: string | undefined;

        if (selectedItem.target) {
            // Option 1: Selected target
            targetToRun = selectedItem.target;
            extraArgs = await this.getExtraArgs(false, []);
            if (extraArgs === undefined) return;

        } else if (selectedItem.label === "Specify target...") {
            // Option 2: Specify target
            targetToRun = await vscode.window.showInputBox({
                prompt: "Enter the BuildGraph target name to run",
                title: "Specify Target"
            });
            if (!targetToRun) return;

            extraArgs = await this.getExtraArgs(false, []);
            if (extraArgs === undefined) return;

        } else if (selectedItem.label === "Select target from compiled buildgraph...") {
            // Option 3: Select from list
            const result = await this.runListAndPickTarget(document);
            if (!result?.selectedTarget) {
                return;
            }

            targetToRun = result.selectedTarget;
            parsedOptions = result.parsedOptions;

            extraArgs = await this.getExtraArgs(true, parsedOptions);
            if (extraArgs === undefined) return;
        }

        // Run Command
        if (targetToRun) {
            const command = await this.buildUatCommand(document, false, targetToRun, extraArgs);
            if (command) {
                this.runInTerminal(`& ${command}`);
            }
        }
    }

    // Copies the UAT command to the clipboard. If on a line with a static <Node> or <Aggregate> name, it includes that target.
    public async copyUatCommandline(editor: vscode.TextEditor) {
        const targetName = this.getTargetNameAtLine(editor.document.lineAt(editor.selection.active.line), true);
        const command = await this.buildUatCommand(editor.document, false, targetName, "");
        if (command) {
            vscode.env.clipboard.writeText(command);
            vscode.window.showInformationMessage("BuildGraph command copied to clipboard.");
        }
    }

    // Prompts the user for extra arguments. Returns 'undefined' if the user cancels. Returns a 'string' if the user confirms.
    private async getExtraArgs(isAdvanced: boolean, parsedOptions: string[]): Promise<string | undefined> {
        let prompt: string;
        let placeHolder: string;

        if (isAdvanced) {
            // Show parsed options in placeholder
            prompt = `Enter any -set options (or other args). Format: -set:<option>="<value>" -another`;
            if (parsedOptions.length > 0) {
                placeHolder = `e.g., -set:${parsedOptions[0]}=... -set:${parsedOptions[1] || '...'}=...`;
            } else {
                placeHolder = "e.g., -set:MyVar=true -ListOnly";
            }
        } else {
            // Simple prompt
            prompt = `Enter any extra UAT arguments (optional). Format: -set:<option>="<value>" -another`;
            placeHolder = `e.g., -set:MyVar=true -ListOnly`;
        }

        const extraArgs = await vscode.window.showInputBox({
            title: "Extra BuildGraph Arguments",
            prompt: prompt,
            placeHolder: placeHolder,
        });

        if (extraArgs === undefined) {
            return undefined;
        }

        return extraArgs.trim();
    }

    // Runs the -ListOnly command in the background, parses targets and options, and shows a Quick Pick with the targets.
    private async runListAndPickTarget(document: vscode.TextDocument): Promise<{ selectedTarget: string; parsedOptions: string[] } | undefined> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Compiling BuildGraph...",
            cancellable: true
        }, async (progress, token) => {

            // Build the -ListOnly command (no target, no options)
            const listCommand = await this.buildUatCommand(document, true, undefined, undefined);
            if (!listCommand) {
                vscode.window.showErrorMessage("Could not build UAT command.");
                return undefined;
            }

            let stdout: string;
            try {
                // Run the command in the background
                progress.report({ message: "Running UAT -ListOnly..." });
                const execResult = await execPromise(listCommand);
                stdout = execResult.stdout;
                if (execResult.stderr) {
                    console.warn("BuildGraph ListOnly Stderr:", execResult.stderr);
                }
            } catch (e) {
                // Show error message if exec fails
                const message = e instanceof Error ? e.message : String(e);
                vscode.window.showErrorMessage(`Failed to run UAT: ${message}`);
                return undefined;
            }

            if (token.isCancellationRequested) return undefined;

            // Parse the output for targets AND options
            progress.report({ message: "Parsing targets and options..." });
            const parseResult = this.parseListOutput(stdout);

            if (parseResult.targets.length === 0) {
                vscode.window.showWarningMessage("No 'Node:' or 'Aggregates:' found in UAT output.");
                return undefined;
            }

            // Convert parsed targets into QuickPickItems with icons
            const quickPickItems: vscode.QuickPickItem[] = parseResult.targets.map(target => ({
                label: target.name,
                iconPath: new vscode.ThemeIcon(target.type === 'node' ? 'symbol-function' : 'symbol-package'),
                description: target.type === 'node' ? 'Node' : 'Aggregate'
            }));

            // Show the final Quick Pick
            const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
                title: "Select Compiled Target",
                placeHolder: "Choose a node or aggregate to run"
            });

            if (selectedItem?.label) {
                return {
                    selectedTarget: selectedItem.label,
                    parsedOptions: parseResult.options
                };
            }

            return undefined;
        });
    }

    // Parses the stdout from a -ListOnly command to find Nodes, Aggregates, and Options.
    private parseListOutput(stdout: string): { targets: { name: string, type: 'node' | 'aggregate' }[], options: string[] } {
        const targets: { name: string, type: 'node' | 'aggregate' }[] = [];
        const seenTargetNames = new Set<string>();
        const options: string[] = [];

        const lines = stdout.split('\n');

        let inOptions = false;
        let inGraph = false;
        let inAggregates = false;

        for (const line of lines) {
            const trimmedLine = line.trim();

            if (trimmedLine === 'Options:') {
                inOptions = true;
                inGraph = false;
                inAggregates = false;
                continue;
            }
            if (trimmedLine === 'Graph:') {
                inOptions = false;
                inGraph = true;
                inAggregates = false;
                continue;
            }
            if (trimmedLine === 'Aggregates:') {
                inOptions = false;
                inGraph = false;
                inAggregates = true;
                continue;
            }

            if (inOptions) {
                // Match "-set:OptionName=..."
                const optionMatch = trimmedLine.match(/^-set:([\w\d_]+)=/);
                if (optionMatch) {
                    options.push(optionMatch[1]);
                }
            } else if (inGraph) {
                // Match "Node: Node Name"
                const nodeMatch = trimmedLine.match(/^Node:\s+(.+)$/);
                if (nodeMatch) {
                    const targetName = nodeMatch[1].trim();
                    if (!seenTargetNames.has(targetName)) {
                        targets.push({ name: targetName, type: 'node' });
                        seenTargetNames.add(targetName);
                    }
                }
            } else if (inAggregates) {
                // Match any non-empty line
                if (trimmedLine.length === 0) {
                    inAggregates = false;
                } else if (!trimmedLine.startsWith("BUILD SUCCESSFUL") && !trimmedLine.startsWith("AutomationTool")) {
                    const targetName = trimmedLine;
                    if (!seenTargetNames.has(targetName)) {
                        targets.push({ name: targetName, type: 'aggregate' });
                        seenTargetNames.add(targetName);
                    }
                }
            }
        }

        return {
            targets: targets.sort((a, b) => a.name.localeCompare(b.name)),
            options: [...new Set(options)].sort()
        };
    }

    private async buildUatCommand(
        document: vscode.TextDocument,
        listOnly: boolean,
        targetName: string | undefined,
        extraArgs: string | undefined
    ): Promise<string | undefined> {

        const scriptDir = path.dirname(document.uri.fsPath);
        const uatPath = await this.findRunUat(scriptDir);
        if (!uatPath) {
            vscode.window.showErrorMessage("Could not find RunUAT.bat in any parent directory.");
            return undefined;
        }

        const scriptPath = document.uri.fsPath;
        const uatDir = path.dirname(uatPath);

        const relativeScriptPath = path.relative(uatDir, scriptPath);

        let baseCommand = `BuildGraph -Script="${relativeScriptPath}"`;

        if (targetName) {
            baseCommand += ` -Target="${targetName}"`;
        }

        if (listOnly) {
            baseCommand += " -ListOnly";
        }

        if (extraArgs) {
            baseCommand += ` ${extraArgs}`;
        }

        return `"${uatPath}" ${baseCommand}`;
    }

    // Gets the target name from the current line, with a 'strict' check for variables.
    private getTargetNameAtLine(line: vscode.TextLine, strict: boolean): string | undefined {
        const regex = /<(Node|Aggregate)\s+[^>]*Name="([^"]+)"/i;
        const match = line.text.match(regex);

        if (match && match[2]) {
            const targetName = match[2];
            if (strict && (targetName.includes('$'))) {
                return undefined;
            }
            return targetName;
        }
        return undefined;
    }

    // Finds or creates a terminal and runs the command.
    private runInTerminal(command: string) {
        if (!this.terminal || this.terminal.exitStatus) {
            this.terminal = vscode.window.createTerminal("BuildGraph UAT");
        }
        this.terminal.show(false);
        this.terminal.sendText(command, true);
    }

    // Recursively searches upwards from startDir to find RunUAT.bat.
    private async findRunUat(startDir: string): Promise<string | undefined> {
        let currentDir = startDir;

        while (true) {
            const uatPath = path.join(currentDir, 'RunUAT.bat');
            const uatUri = vscode.Uri.file(uatPath);

            try {
                await vscode.workspace.fs.stat(uatUri);
                return uatPath;
            } catch (e) {
                const parentDir = path.dirname(currentDir);
                if (parentDir === currentDir) {
                    return undefined;
                }
                currentDir = parentDir;
            }
        }
    }
}
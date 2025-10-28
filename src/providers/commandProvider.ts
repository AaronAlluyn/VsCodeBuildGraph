import * as vscode from 'vscode';
import * as path from 'path';

export class BuildGraphCommandProvider {
    private terminal: vscode.Terminal | undefined;

    public async runTarget(editor: vscode.TextEditor, edit: vscode.TextEditorEdit) {
        await this.runBuildGraphCommand(editor, false);
    }

    public async runTargetListOnly(editor: vscode.TextEditor, edit: vscode.TextEditorEdit) {
        await this.runBuildGraphCommand(editor, true);
    }

    private async runBuildGraphCommand(editor: vscode.TextEditor, listOnly: boolean) {
        const document = editor.document;
        const position = editor.selection.active;

        // Find the target name at the cursor's line
        const targetName = this.getTargetNameAtLine(document.lineAt(position.line));
        if (!targetName) {
            vscode.window.showWarningMessage("No <Node> or <Aggregate> 'Name' attribute found on this line.");
            return;
        }

        // Find RunUAT.bat by searching upwards
        const scriptDir = path.dirname(document.uri.fsPath);
        const uatPath = await this.findRunUat(scriptDir);
        if (!uatPath) {
            vscode.window.showErrorMessage("Could not find RunUAT.bat in any parent directory.");
            return;
        }

        // Build the command
        const scriptPath = document.uri.fsPath;
        const listOnlyFlag = listOnly ? " -ListOnly" : "";
        const command = `& "${uatPath}" BuildGraph -Script="${scriptPath}" -Target="${targetName}"${listOnlyFlag}`;

        // Get or create the terminal
        if (!this.terminal || this.terminal.exitStatus) {
            this.terminal = vscode.window.createTerminal("BuildGraph UAT");
        }

        // Run the command
        this.terminal.show(false);
        this.terminal.sendText(command, true);
    }

    private getTargetNameAtLine(line: vscode.TextLine): string | undefined {
        // Regex to find <Node ... Name="Value"> or <Aggregate ... Name="Value">
        const regex = /<(Node|Aggregate)\s+[^>]*Name="([^"]+)"/i;
        const match = line.text.match(regex);
        
        if (match && match[2]) {
            return match[2];
        }

        return undefined;
    }

    private async findRunUat(startDir: string): Promise<string | undefined> {
        let currentDir = startDir;

        while (true) {
            const uatPath = path.join(currentDir, 'RunUAT.bat');
            const uatUri = vscode.Uri.file(uatPath);

            try {
                await vscode.workspace.fs.stat(uatUri);
                // File exists, return the path
                return uatPath;
            } catch (e) {
                // File does not exist, go up one directory
                const parentDir = path.dirname(currentDir);

                // If we've hit the root, stop
                if (parentDir === currentDir) {
                    return undefined;
                }
                
                currentDir = parentDir;
            }
        }
    }
}
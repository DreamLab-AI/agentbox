import sys
import json
import subprocess

def run_command(command):
    """Executes a subprocess command and returns a structured response."""
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=True)
        return {
            "success": True,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "command": " ".join(command)
        }
    except subprocess.CalledProcessError as e:
        return {
            "success": False,
            "error": "Command failed with a non-zero exit code.",
            "stdout": e.stdout,
            "stderr": e.stderr,
            "returncode": e.returncode,
            "command": " ".join(command)
        }
    except FileNotFoundError:
        return {"success": False, "error": f"Command not found: {command[0]}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

def create_image(params):
    """Creates a new image using ImageMagick."""
    width = params.get('width', 100)
    height = params.get('height', 100)
    color = params.get('color', 'white')
    output_file = params.get('output')

    if not output_file:
        return {"success": False, "error": "Missing required parameter: output"}

    command = [
        'convert',
        '-size', f'{width}x{height}',
        f'xc:{color}',
        output_file
    ]
    return run_command(command)

def convert_image(params):
    """Runs a generic ImageMagick 'convert' command."""
    args = params.get('args')
    if not args or not isinstance(args, list):
        return {"success": False, "error": "Missing or invalid 'args' parameter. It must be a list of strings."}

    command = ['convert'] + args
    return run_command(command)

def main():
    """Main loop to handle MCP requests."""
    for line in sys.stdin:
        try:
            request = json.loads(line)
            method = request.get('method')
            params = request.get('params', {})

            response = {}
            if method == 'create':
                response['result'] = create_image(params)
            elif method == 'convert':
                response['result'] = convert_image(params)
            else:
                response['error'] = f"Unknown method: {method}. Available methods: 'create', 'convert'."

            sys.stdout.write(json.dumps(response) + '\n')
            sys.stdout.flush()
        except json.JSONDecodeError:
            error_response = {"error": "Invalid JSON received"}
            sys.stdout.write(json.dumps(error_response) + '\n')
            sys.stdout.flush()
        except Exception as e:
            error_response = {"error": f"An unexpected error occurred: {str(e)}"}
            sys.stdout.write(json.dumps(error_response) + '\n')
            sys.stdout.flush()

if __name__ == "__main__":
    main()
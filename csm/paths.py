import os

def config_dir():
    env = os.environ.get("CLAUDE_CONFIG_DIR")
    if env:
        return env
    return os.path.join(os.path.expanduser("~"), ".claude")

def projects_dir():
    return os.path.join(config_dir(), "projects")

def claude_command():
    return "claude"

def index_db_path():
    return os.path.join(config_dir(), "csm-index.db")

def favorites_path():
    return os.path.join(config_dir(), "csm-fav.json")

def trash_meta_path():
    return os.path.join(config_dir(), "csm-trash.json")

def trash_dir():
    return os.path.join(projects_dir(), "_trash")

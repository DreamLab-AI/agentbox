# Host-only SBOM tooling: sqliteschema 2.0.1 and SimpleSQLite 1.5.4 still
# require typepy < 2. Keep the newest compatible release until both consumers
# support 2.x; do not relax their runtime dependency checks.
{ pkgs }:
pkgs.python3.override {
  packageOverrides = pyFinal: pyPrev: {
    typepy = pyPrev.typepy.overridePythonAttrs (_: {
      version = "1.3.5";
      src = pkgs.fetchPypi {
        pname = "typepy";
        version = "1.3.5";
        hash = "sha256-ocX1TEGGD4m6sXX1ErEejJpXz+e4s9WuXVLYKLdWtt0=";
      };
    });
  };
}

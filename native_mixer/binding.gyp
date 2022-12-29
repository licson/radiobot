{
  "targets": [
    {
      "target_name": "mix",
      "cflags!": [ "-fno-exceptions", "-O3" ],
      "cflags_cc!": [ "-fno-exceptions", "-O3" ],
      "sources": [ "mix.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      'defines': [ 'NAPI_DISABLE_CPP_EXCEPTIONS' ],
    }
  ]
}
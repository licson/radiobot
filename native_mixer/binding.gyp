{
	"targets": [
		{
			"target_name": "mix",
			"sources": [ "mix.cc" ],
			"include_dirs": [
				"<!(node -e \"require('nan')\")"
			],
			"conditions": [
				[
					"OS==\"linux\"",
					{
						"cflags": [
							"-O3",
							"-Wall"
						]
					}
				]
			]
		}
	]
}
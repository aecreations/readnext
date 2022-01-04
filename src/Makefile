# Makefile for Read Next

EXT_VER=`./getver.pl`
DIST_FILE=readnext-$(EXT_VER).zip
EXCLUDE=*~ *\.pl Makefile


$(DIST_FILE):
	zip -r $(DIST_FILE) * -x $(EXCLUDE)

clean:
	rm -v *.zip

# END Makefile
